import { Hono } from "hono";
import { and, eq, isNull, ne } from "drizzle-orm";
import { competitors, monitors } from "@outrival/db";
import { db } from "../lib/db";
import { analyticsQuery, sql } from "../lib/analytics-safe";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const activityRouter = new Hono<{ Variables: Variables }>();

activityRouter.use("*", authMiddleware);

// Internal monitoring anchors that carry no user-facing meaning — never surfaced
// as activity (tech_stack: isActive=false anchor; sitemap: internal discovery;
// news: Google News RSS anchor feeding company/funding signals).
const HIDDEN_SOURCES = ["tech_stack", "sitemap", "news"] as const;
const HIDDEN_SET = new Set<string>(HIDDEN_SOURCES);

// Excludes the self-competitor: the user's own product is monitored too, but it
// belongs on the "My product" page, not in this competitor-facing activity feed.
async function orgCompetitors(orgId: string) {
  return db
    .select({ id: competitors.id, name: competitors.name })
    .from(competitors)
    .where(
      and(
        eq(competitors.orgId, orgId),
        isNull(competitors.deletedAt),
        ne(competitors.type, "self"),
      ),
    );
}

// Current per-source health: when each monitored source last ran, when it runs
// next, and a derived status. Pure relational (monitors ⋈ competitors), org-scoped.
// Answers "is everything working" — distinct from the event timeline below.
activityRouter.get("/health", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const rows = await db
    .select({
      monitorId: monitors.id,
      competitorId: competitors.id,
      competitorName: competitors.name,
      sourceType: monitors.sourceType,
      isActive: monitors.isActive,
      lastRunAt: monitors.lastRunAt,
      nextRunAt: monitors.nextRunAt,
      consecutiveFailures: monitors.consecutiveFailures,
      markedUnscrapable: monitors.markedUnscrapable,
    })
    .from(monitors)
    .innerJoin(competitors, eq(monitors.competitorId, competitors.id))
    .where(
      and(
        eq(competitors.orgId, orgId),
        isNull(competitors.deletedAt),
        // Self-product monitoring lives on "My product", not in this feed.
        ne(competitors.type, "self"),
      ),
    );

  const sources = rows
    .filter((r) => !HIDDEN_SET.has(r.sourceType))
    .map((r) => ({
      monitorId: r.monitorId,
      competitorId: r.competitorId,
      competitorName: r.competitorName,
      sourceType: r.sourceType,
      lastRunAt: r.lastRunAt,
      nextRunAt: r.nextRunAt,
      status: r.markedUnscrapable
        ? "unscrapable"
        : !r.isActive
          ? "paused"
          : r.consecutiveFailures > 0
            ? "failing"
            : "ok",
    }))
    // Most-recently-run first; never-run (null lastRunAt) sink to the bottom.
    .sort((a, b) => (b.lastRunAt?.getTime() ?? 0) - (a.lastRunAt?.getTime() ?? 0));

  // "Next checks" — the soonest scheduled runs, soonest-first. Unlike `sources`
  // this INCLUDES the internal anchors (sitemap/news) that carry a real nextRunAt:
  // they run silently in the background, and showing when they run next closes the
  // "is Outrival still watching?" gap. tech_stack drops out naturally — it's
  // interval-driven (no nextRunAt) and shows its own next scan on the competitor
  // page. Paused / unscrapable monitors are excluded (they won't run).
  const upcoming = rows
    .filter((r) => r.isActive && !r.markedUnscrapable && r.nextRunAt)
    .map((r) => ({
      monitorId: r.monitorId,
      competitorId: r.competitorId,
      competitorName: r.competitorName,
      sourceType: r.sourceType,
      nextRunAt: r.nextRunAt,
    }))
    .sort((a, b) => (a.nextRunAt!.getTime() ?? 0) - (b.nextRunAt!.getTime() ?? 0))
    .slice(0, 12);

  return c.json({ sources, upcoming });
});

// Recent scraping activity — the work done (incl. no-change runs and failures,
// the value the Signals feed never shows). scrape_runs is org-agnostic (no org_id,
// no FK), so we filter by the org's competitor ids, which also enforces tenant
// isolation. Best-effort via analyticsQuery: a hiccup degrades to an empty page.
interface RawRun {
  competitorId: string;
  sourceType: string;
  status: string;
  durationMs: number;
  recordedAt: string;
  changeId: string | null;
  changeSummary: string | null;
  // Typed homepage breakdown (changes.structured_diff) + the AI-distilled plain
  // before/after off the signal (any source). Both feed the expandable detail.
  structuredDiff: unknown;
  humanChangeBefore: string | null;
  humanChangeAfter: string | null;
  // True only for a monitor's baseline capture: a successful run that wrote a
  // snapshot but produced no change row, with no earlier snapshot to diff against.
  // Lets the UI label it "First capture" instead of the misleading "Change detected".
  isFirstCapture: boolean;
}

// One readable change for the expandable detail: a typed label + a before/after,
// shaped from the raw structured_diff so no raw lines (bodyDiff) reach the client.
interface ReadableChange {
  kind: string;
  field: string;
  before: string | null;
  after: string | null;
}

function shapeStructured(raw: unknown): ReadableChange[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      kind: typeof c.kind === "string" ? c.kind : "",
      field: typeof c.field === "string" ? c.field : "",
      before: typeof c.before === "string" ? c.before : null,
      after: typeof c.after === "string" ? c.after : null,
    }))
    // section_reordered carries no readable before/after — pure noise here.
    .filter((c) => c.kind && c.kind !== "section_reordered");
}

// "Change detected" runs carry no diff in scrape_runs, so we attach the change
// the run produced. monitor_id + a tight ±5min window around recorded_at matches
// at most one change (a monitor emits one change per run), so this can't mismatch.
function cleanSummary(s: string | null): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > 140 ? `${t.slice(0, 140)}…` : t;
}

activityRouter.get("/timeline", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const limit = Math.min(Number(c.req.query("limit") ?? 25), 100);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);

  // Optional filters. competitorId is also IN-constrained below, so a foreign id
  // simply returns nothing — tenant isolation holds regardless of input.
  const competitorId = c.req.query("competitorId");
  const sourceType = c.req.query("sourceType");
  // Filter by the user-facing OUTCOME, not the raw scrape_runs.status: a "success"
  // run is split into a real "change" (has a change row), a "first_capture"
  // (baseline, no diff possible) and "no_change" (content shifted but nothing
  // meaningful — folded with the dedup no-change runs). "failed" maps 1:1.
  const statusRaw = c.req.query("status");
  const STATUS_FILTERS = ["change", "first_capture", "no_change", "failed"] as const;
  const status = (STATUS_FILTERS as readonly string[]).includes(statusRaw ?? "")
    ? (statusRaw as (typeof STATUS_FILTERS)[number])
    : undefined;

  const comps = await orgCompetitors(orgId);
  const nameById = new Map(comps.map((x) => [x.id, x.name]));
  const ids = comps.map((x) => x.id);
  if (ids.length === 0) return c.json({ events: [] });

  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  const hiddenList = sql.join(
    HIDDEN_SOURCES.map((s) => sql`${s}`),
    sql`, `,
  );

  // A run has an earlier snapshot when the monitor was already captured before it.
  // The 5-min margin excludes the run's own snapshot (its scraped_at sits a few
  // seconds before recorded_at); real captures are ≥1h apart (hourly scrape cron),
  // so this never mistakes a second capture for a baseline. Reused by the
  // first_capture filter and the isFirstCapture projection below.
  const earlierSnapshot = sql`EXISTS (
    SELECT 1 FROM snapshots s
    WHERE s.monitor_id = r.monitor_id
      AND s.scraped_at < r.recorded_at - interval '5 minutes'
  )`;

  const conds = [
    sql`r.competitor_id IN (${idList})`,
    sql`r.source_type NOT IN (${hiddenList})`,
  ];
  if (competitorId) conds.push(sql`r.competitor_id = ${competitorId}`);
  if (sourceType) conds.push(sql`r.source_type = ${sourceType}`);
  // ch.id (the LATERAL-joined change row, gated ON r.status='success') is in scope
  // here, so the outcome buckets can be expressed directly in the WHERE clause.
  if (status === "change") conds.push(sql`r.status = 'success' AND ch.id IS NOT NULL`);
  else if (status === "first_capture")
    conds.push(sql`r.status = 'success' AND ch.id IS NULL AND NOT ${earlierSnapshot}`);
  else if (status === "no_change")
    conds.push(
      sql`(r.status = 'no_change' OR (r.status = 'success' AND ch.id IS NULL AND ${earlierSnapshot}))`,
    );
  else if (status === "failed") conds.push(sql`r.status = 'failed'`);
  const where = sql.join(conds, sql` AND `);

  const rows = await analyticsQuery<RawRun>(sql`
    SELECT r.competitor_id AS "competitorId", r.source_type AS "sourceType", r.status,
           r.duration_ms AS "durationMs", r.recorded_at AS "recordedAt",
           ch.id AS "changeId",
           COALESCE(ch.summary, LEFT(ch.diff_text, 400)) AS "changeSummary",
           ch.structured_diff AS "structuredDiff",
           sig.human_change_before AS "humanChangeBefore",
           sig.human_change_after AS "humanChangeAfter",
           (r.status = 'success' AND ch.id IS NULL AND NOT ${earlierSnapshot}) AS "isFirstCapture"
    FROM scrape_runs r
    LEFT JOIN LATERAL (
      SELECT c.id, c.summary, c.diff_text, c.structured_diff
      FROM changes c
      WHERE c.monitor_id = r.monitor_id
        AND c.detected_at BETWEEN r.recorded_at - interval '5 minutes'
                              AND r.recorded_at + interval '5 minutes'
      ORDER BY abs(extract(epoch FROM (c.detected_at - r.recorded_at)))
      LIMIT 1
    ) ch ON r.status = 'success'
    LEFT JOIN signals sig ON sig.change_id = ch.id
    WHERE ${where}
    ORDER BY r.recorded_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const events = rows.map((r) => ({
    competitorId: r.competitorId,
    competitorName: nameById.get(r.competitorId) ?? "Unknown",
    sourceType: r.sourceType,
    status: r.status, // success | no_change | failed
    durationMs: r.durationMs,
    recordedAt: r.recordedAt,
    changeId: r.changeId,
    changeSummary: cleanSummary(r.changeSummary),
    structuredChanges: shapeStructured(r.structuredDiff),
    humanChangeBefore: r.humanChangeBefore,
    humanChangeAfter: r.humanChangeAfter,
    isFirstCapture: r.isFirstCapture === true,
  }));

  return c.json({ events });
});
