import { Hono } from "hono";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { competitors, monitors } from "@outrival/db";
import { db } from "../lib/db";
import { analyticsQuery, sql } from "../lib/analytics-safe";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { productCompetitorIds } from "../lib/products";

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
    .select({ id: competitors.id, name: competitors.name, url: competitors.url })
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

  // patch-28 — optional product scope: restrict the source roster to the product's
  // linked competitors. Absent → all org competitors (unchanged).
  const productId = c.req.query("productId");
  const restrictIds = productId ? await productCompetitorIds(orgId, productId) : null;
  // A product with no linked competitors → nothing to show (avoids inArray([])).
  if (restrictIds && restrictIds.length === 0) {
    return c.json({ sources: [], upcoming: [] });
  }

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
        restrictIds ? inArray(competitors.id, restrictIds) : undefined,
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
  // The page this run actually inspected (snapshot's resolved URL) and when the
  // monitor last truly changed — context for a no-change / first-capture row so it
  // isn't a dead end: link out to the live page, say "unchanged since …".
  resolvedUrl: string | null;
  lastChangedAt: string | null;
  // What a data source captured on this run, matched to the analytics batch
  // nearest the run (see the LATERAL joins below). Only one family is populated
  // per row — the one matching source_type. Null fields = no batch / not a data
  // source. These carry the value a baseline/no-change run otherwise hides.
  jobsTotal: number | null;
  jobsTeams: number | null;
  jobsByDept: Array<{ department: string; count: number }> | null;
  pricingPlanCount: number | null;
  pricingMinPrice: number | null;
  pricingMaxPrice: number | null;
  pricingCurrency: string | null;
  pricingPlans: Array<{
    planName: string;
    price: number | null;
    currency: string;
    billingPeriod: string;
  }> | null;
  reviewScore: number | null;
  reviewCount: number | null;
  reviewSubs: {
    easeOfUse: number | null;
    support: number | null;
    features: number | null;
    value: number | null;
  } | null;
}

// The captured-data summary attached to a timeline event. Discriminated by the
// data family; the UI renders a one-line summary in the "Captured" column and a
// breakdown when the row is expanded. Null when the source has no structured
// payload (homepage/blog/changelog) or the run failed.
type CapturedSummary =
  | {
      kind: "jobs";
      total: number;
      teams: number;
      byDept: Array<{ department: string; count: number }>;
    }
  | {
      kind: "pricing";
      planCount: number;
      minPrice: number | null;
      maxPrice: number | null;
      currency: string | null;
      plans: Array<{
        planName: string;
        price: number | null;
        currency: string;
        billingPeriod: string;
      }>;
    }
  | {
      kind: "reviews";
      score: number | null;
      reviewCount: number;
      subScores: {
        easeOfUse: number | null;
        support: number | null;
        features: number | null;
        value: number | null;
      } | null;
    };

// Shape the per-family captured columns into one discriminated summary. A failed
// run captured nothing (we couldn't reach the page), so it stays null instead of
// reading as "nothing found". A data source with no batch (extraction came back
// empty) keeps its kind with zeroed counts → the UI says "Nothing found".
function shapeCaptured(r: RawRun): CapturedSummary | null {
  if (r.status === "failed") return null;
  if (r.sourceType === "jobs") {
    return {
      kind: "jobs",
      total: r.jobsTotal ?? 0,
      teams: r.jobsTeams ?? 0,
      byDept: Array.isArray(r.jobsByDept) ? r.jobsByDept : [],
    };
  }
  if (r.sourceType === "pricing") {
    return {
      kind: "pricing",
      planCount: r.pricingPlanCount ?? 0,
      minPrice: r.pricingMinPrice,
      maxPrice: r.pricingMaxPrice,
      currency: r.pricingCurrency,
      plans: Array.isArray(r.pricingPlans) ? r.pricingPlans : [],
    };
  }
  if (/_reviews$/.test(r.sourceType)) {
    const s = r.reviewSubs;
    const hasSub =
      !!s && (s.easeOfUse != null || s.support != null || s.features != null || s.value != null);
    return {
      kind: "reviews",
      score: r.reviewScore,
      reviewCount: r.reviewCount ?? 0,
      subScores: hasSub ? s : null,
    };
  }
  return null;
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

  // patch-28 — optional product scope (same as /health).
  const productId = c.req.query("productId");
  let comps = await orgCompetitors(orgId);
  if (productId) {
    const allowed = new Set(await productCompetitorIds(orgId, productId));
    comps = comps.filter((x) => allowed.has(x.id));
  }
  const nameById = new Map(comps.map((x) => [x.id, x.name]));
  const urlById = new Map(comps.map((x) => [x.id, x.url]));
  const ids = comps.map((x) => x.id);
  if (ids.length === 0) return c.json({ events: [], total: 0 });

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
    -- recorded_at / last_changed_at are naive timestamp columns holding UTC
    -- wall-clock (Drizzle writes them via toISOString, reads them back as +0000).
    -- This raw query bypasses Drizzle's column parser, so postgres.js would hand
    -- back a Date parsed in the server's LOCAL tz — a skew equal to the server
    -- offset (a just-now run shows "2h ago" on a CEST box). AT TIME ZONE 'UTC'
    -- makes the instant explicit (timestamptz), so it serializes as correct UTC.
    SELECT r.competitor_id AS "competitorId", r.source_type AS "sourceType", r.status,
           r.duration_ms AS "durationMs", (r.recorded_at AT TIME ZONE 'UTC') AS "recordedAt",
           ch.id AS "changeId",
           COALESCE(ch.summary, LEFT(ch.diff_text, 400)) AS "changeSummary",
           ch.structured_diff AS "structuredDiff",
           sig.human_change_before AS "humanChangeBefore",
           sig.human_change_after AS "humanChangeAfter",
           (r.status = 'success' AND ch.id IS NULL AND NOT ${earlierSnapshot}) AS "isFirstCapture",
           (m.last_changed_at AT TIME ZONE 'UTC') AS "lastChangedAt",
           snap.resolved_url AS "resolvedUrl",
           jobcap.total AS "jobsTotal", jobcap.teams AS "jobsTeams",
           jobcap.by_dept AS "jobsByDept",
           pricecap.plan_count AS "pricingPlanCount", pricecap.min_price AS "pricingMinPrice",
           pricecap.max_price AS "pricingMaxPrice", pricecap.currency AS "pricingCurrency",
           pricecap.plans AS "pricingPlans",
           reviewcap.score AS "reviewScore", reviewcap.review_count AS "reviewCount",
           reviewcap.subs AS "reviewSubs"
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
    LEFT JOIN monitors m ON m.id = r.monitor_id
    -- Captured data per data source: aggregate the analytics batch nearest this
    -- run (the latest recorded at/just-after the run — extraction lands a touch
    -- after scrape_runs is logged; for a no-change run, no new batch exists so we
    -- carry the last known state, i.e. "still N"). Batches are ≥1 day apart for
    -- these sources, so "latest <= run + 1h" uniquely picks the right one. Each
    -- LATERAL is gated by source_type so a row never borrows another family's data.
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(jc.count), 0)::int AS total, count(*)::int AS teams,
             json_agg(json_build_object('department', jc.department, 'count', jc.count)
                      ORDER BY jc.count DESC) AS by_dept
      FROM job_counts jc
      WHERE jc.competitor_id = r.competitor_id
        AND jc.recorded_at = (
          SELECT max(jc2.recorded_at) FROM job_counts jc2
          WHERE jc2.competitor_id = r.competitor_id
            AND jc2.recorded_at <= r.recorded_at + interval '1 hour'
        )
    ) jobcap ON r.source_type = 'jobs'
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS plan_count,
             min(ph.price) FILTER (WHERE ph.price > 0) AS min_price,
             max(ph.price) AS max_price, max(ph.currency) AS currency,
             json_agg(json_build_object('planName', ph.plan_name, 'price', ph.price,
                                        'currency', ph.currency, 'billingPeriod', ph.billing_period)
                      ORDER BY ph.price NULLS LAST) AS plans
      FROM pricing_history ph
      WHERE ph.competitor_id = r.competitor_id
        AND ph.recorded_at = (
          SELECT max(ph2.recorded_at) FROM pricing_history ph2
          WHERE ph2.competitor_id = r.competitor_id
            AND ph2.recorded_at <= r.recorded_at + interval '1 hour'
        )
    ) pricecap ON r.source_type = 'pricing'
    LEFT JOIN LATERAL (
      SELECT rs.score, rs.review_count,
             json_build_object('easeOfUse', rs.sub_ease_of_use, 'support', rs.sub_support,
                               'features', rs.sub_features, 'value', rs.sub_value) AS subs
      FROM review_scores rs
      WHERE rs.competitor_id = r.competitor_id
        AND rs.source = replace(r.source_type, '_reviews', '')
        AND rs.recorded_at = (
          SELECT max(rs2.recorded_at) FROM review_scores rs2
          WHERE rs2.competitor_id = r.competitor_id
            AND rs2.source = replace(r.source_type, '_reviews', '')
            AND rs2.recorded_at <= r.recorded_at + interval '1 hour'
        )
      LIMIT 1
    ) reviewcap ON r.source_type ~ '_reviews$'
    -- The page this run inspected, by its resolved URL. A no-change run writes no
    -- new snapshot (content-hash dedup), so we take the monitor's latest snapshot
    -- as of the run — the actual monitored page (e.g. the pricing URL), not just
    -- the run's own write. Bounded to <= run time so old rows stay accurate.
    LEFT JOIN LATERAL (
      SELECT s.resolved_url
      FROM snapshots s
      WHERE s.monitor_id = r.monitor_id
        AND s.scraped_at <= r.recorded_at + interval '5 minutes'
      ORDER BY s.scraped_at DESC
      LIMIT 1
    ) snap ON true
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
    // Live page to link out to: the resolved URL of the captured snapshot, else
    // the competitor's site as a fallback (old/failed runs have no snapshot).
    url: r.resolvedUrl ?? urlById.get(r.competitorId) ?? null,
    lastChangedAt: r.lastChangedAt,
    captured: shapeCaptured(r),
  }));

  // Total matching rows, for numbered pagination. Expressed without the LATERAL
  // change/signal joins of the page query — the outcome buckets only need to know
  // whether a matching change row EXISTS, so this stays a single indexed scan over
  // scrape_runs. changeExists mirrors the LATERAL's ±5-min match window.
  const changeExists = sql`EXISTS (
    SELECT 1 FROM changes c
    WHERE c.monitor_id = r.monitor_id
      AND c.detected_at BETWEEN r.recorded_at - interval '5 minutes'
                            AND r.recorded_at + interval '5 minutes'
  )`;
  const countConds = [
    sql`r.competitor_id IN (${idList})`,
    sql`r.source_type NOT IN (${hiddenList})`,
  ];
  if (competitorId) countConds.push(sql`r.competitor_id = ${competitorId}`);
  if (sourceType) countConds.push(sql`r.source_type = ${sourceType}`);
  if (status === "change") countConds.push(sql`r.status = 'success' AND ${changeExists}`);
  else if (status === "first_capture")
    countConds.push(sql`r.status = 'success' AND NOT ${changeExists} AND NOT ${earlierSnapshot}`);
  else if (status === "no_change")
    countConds.push(
      sql`(r.status = 'no_change' OR (r.status = 'success' AND NOT ${changeExists} AND ${earlierSnapshot}))`,
    );
  else if (status === "failed") countConds.push(sql`r.status = 'failed'`);
  const countWhere = sql.join(countConds, sql` AND `);

  const countRows = await analyticsQuery<{ total: number }>(sql`
    SELECT count(*)::int AS total FROM scrape_runs r WHERE ${countWhere}
  `);
  // Best-effort (analyticsQuery returns [] on error) — fall back to what we can see.
  const total = countRows[0]?.total ?? offset + events.length;

  return c.json({ events, total });
});
