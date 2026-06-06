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
// as activity (tech_stack: isActive=false anchor; sitemap: internal discovery).
const HIDDEN_SOURCES = ["tech_stack", "sitemap"] as const;
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

  return c.json({ sources });
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
  const statusRaw = c.req.query("status");
  const status = ["success", "no_change", "failed"].includes(statusRaw ?? "")
    ? statusRaw
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

  const conds = [
    sql`r.competitor_id IN (${idList})`,
    sql`r.source_type NOT IN (${hiddenList})`,
  ];
  if (competitorId) conds.push(sql`r.competitor_id = ${competitorId}`);
  if (sourceType) conds.push(sql`r.source_type = ${sourceType}`);
  if (status) conds.push(sql`r.status = ${status}`);
  const where = sql.join(conds, sql` AND `);

  const rows = await analyticsQuery<RawRun>(sql`
    SELECT r.competitor_id AS "competitorId", r.source_type AS "sourceType", r.status,
           r.duration_ms AS "durationMs", r.recorded_at AS "recordedAt",
           ch.id AS "changeId",
           COALESCE(ch.summary, LEFT(ch.diff_text, 400)) AS "changeSummary"
    FROM scrape_runs r
    LEFT JOIN LATERAL (
      SELECT c.id, c.summary, c.diff_text
      FROM changes c
      WHERE c.monitor_id = r.monitor_id
        AND c.detected_at BETWEEN r.recorded_at - interval '5 minutes'
                              AND r.recorded_at + interval '5 minutes'
      ORDER BY abs(extract(epoch FROM (c.detected_at - r.recorded_at)))
      LIMIT 1
    ) ch ON r.status = 'success'
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
  }));

  return c.json({ events });
});
