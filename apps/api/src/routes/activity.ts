import { Hono } from "hono";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { competitors, monitors } from "@outrival/db";
import { db } from "../lib/db";
import { analyticsQuery, sql } from "../lib/analytics-safe";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { productCompetitorIds, productSelfCompetitorId } from "../lib/products";

type Variables = { user: { id: string } };

export const activityRouter = new Hono<{ Variables: Variables }>();

activityRouter.use("*", authMiddleware);

// Internal monitoring anchors that carry no user-facing meaning — never surfaced
// as activity (tech_stack: isActive=false anchor; sitemap: internal discovery;
// news: Google News RSS anchor feeding company/funding signals).
const HIDDEN_SOURCES = ["tech_stack", "sitemap", "news", "subdomains", "youtube"] as const;
const HIDDEN_SET = new Set<string>(HIDDEN_SOURCES);

// All monitored entities of the org, INCLUDING the self-competitor (the user's own
// product): its scrapes are real work Outrival does and belong in this feed too. The
// `type` distinguishes self rows so the UI can badge them and link to the product page
// instead of a competitor detail page. Restrict-to-product scoping is applied by the
// callers (see scopedActivityIds).
async function orgCompetitors(orgId: string) {
  return db
    .select({
      id: competitors.id,
      name: competitors.name,
      url: competitors.url,
      color: competitors.color,
      type: competitors.type,
    })
    .from(competitors)
    .where(and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)));
}

// The competitor ids in scope for a given product: its linked competitors
// (product_competitors junction) PLUS the product's own self-competitor, which the
// junction never holds. Absent product → all org competitors (callers pass null).
async function scopedActivityIds(orgId: string, productId: string): Promise<string[]> {
  const [linked, selfId] = await Promise.all([
    productCompetitorIds(orgId, productId),
    productSelfCompetitorId(orgId, productId),
  ]);
  return selfId ? [...linked, selfId] : linked;
}

// Current per-source health: when each monitored source last ran, when it runs
// next, and a derived status. Pure relational (monitors ⋈ competitors), org-scoped.
// Answers "is everything working" — distinct from the event timeline below.
activityRouter.get("/health", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  // patch-28 — optional product scope: restrict the source roster to the product's
  // linked competitors + its own self-product. Absent → all org competitors incl. self.
  const productId = c.req.query("productId");
  const restrictIds = productId ? await scopedActivityIds(orgId, productId) : null;
  // A product with no linked competitors → nothing to show (avoids inArray([])).
  if (restrictIds && restrictIds.length === 0) {
    return c.json({ sources: [], upcoming: [] });
  }

  const rows = await db
    .select({
      monitorId: monitors.id,
      competitorId: competitors.id,
      competitorName: competitors.name,
      competitorColor: competitors.color,
      competitorType: competitors.type,
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
        // Self-product monitoring is now surfaced here too (the user's own scrapes),
        // badged as "your product" by the UI.
        restrictIds ? inArray(competitors.id, restrictIds) : undefined,
      ),
    );

  const sources = rows
    .filter((r) => !HIDDEN_SET.has(r.sourceType))
    .map((r) => ({
      monitorId: r.monitorId,
      competitorId: r.competitorId,
      competitorName: r.competitorName,
      competitorColor: r.competitorColor,
      isSelf: r.competitorType === "self",
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
      competitorColor: r.competitorColor,
      isSelf: r.competitorType === "self",
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
  // The immediately-previous batch's key values (the capture before this run's).
  // Used to compute what moved on a CHANGE row — null when there is no prior batch
  // (first data point) or the run isn't a data source.
  jobsPrevTotal: number | null;
  pricingPrevPlans: Array<{
    planName: string;
    price: number | null;
    currency: string;
    billingPeriod: string;
  }> | null;
  reviewPrevScore: number | null;
  reviewPrevReviewCount: number | null;
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
      // Current plans, each flagged `isNew` when it wasn't in the previous capture
      // (matched by name + billing period) — lets the breakdown highlight additions.
      plans: Array<{
        planName: string;
        price: number | null;
        currency: string;
        billingPeriod: string;
        isNew?: boolean;
      }>;
      // Plans present in the previous capture but gone now — shown struck-through so
      // a drop ("9 → 8 plans") names which tier disappeared, not just the count.
      removedPlans: Array<{
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

// A plan has separate monthly/yearly rows, so match across captures by name AND
// billing period — keying on name alone would collide them. Shared by the captured
// breakdown (added/removed flags) and the delta line so "same plan" means one thing.
const planKey = (p: { planName: string; billingPeriod: string }) =>
  `${p.planName} ${p.billingPeriod}`;

// Shape the per-family captured columns into one discriminated summary. Captured
// reflects what THIS run extracted: only a 'success' run wrote a fresh snapshot and
// re-ran extraction. A 'no_change' run (hash dedup early-return) and a 'failed' run
// extract nothing, so they carry no captured data — left null rather than back-filled
// with the last-known batch, which re-printed a stale "still €14" on every scrape and
// read as a fresh capture repeating. A success data source with no batch (extraction
// came back empty) keeps its kind with zeroed counts → the UI says "Nothing found".
function shapeCaptured(r: RawRun): CapturedSummary | null {
  if (r.status !== "success") return null;
  if (r.sourceType === "jobs") {
    return {
      kind: "jobs",
      total: r.jobsTotal ?? 0,
      teams: r.jobsTeams ?? 0,
      byDept: Array.isArray(r.jobsByDept) ? r.jobsByDept : [],
    };
  }
  if (r.sourceType === "pricing") {
    const cur = Array.isArray(r.pricingPlans) ? r.pricingPlans : [];
    const prev = Array.isArray(r.pricingPrevPlans) ? r.pricingPrevPlans : [];
    // With no prior batch (first capture) nothing is "new" — leave every plan plain.
    const prevKeys = prev.length > 0 ? new Set(prev.map(planKey)) : null;
    const curKeys = new Set(cur.map(planKey));
    return {
      kind: "pricing",
      planCount: r.pricingPlanCount ?? 0,
      minPrice: r.pricingMinPrice,
      maxPrice: r.pricingMaxPrice,
      currency: r.pricingCurrency,
      plans: prevKeys
        ? cur.map((p) => (prevKeys.has(planKey(p)) ? p : { ...p, isNew: true }))
        : cur,
      removedPlans: prevKeys ? prev.filter((p) => !curKeys.has(planKey(p))) : [],
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

// What MOVED on this run, for the "Captured" column on a change row: the delta vs
// the previous capture, not the running total. A total ("3 plans · $10–$50") reads
// oddly next to "What changed", so on a change row we surface the change itself and
// leave the full snapshot to the "View more" breakdown. Quiet runs (no_change,
// first_capture) keep the total via shapeCaptured — that value is their whole point.
type CapturedDelta =
  | { kind: "jobs"; before: number; after: number }
  | { kind: "reviews"; unit: "score" | "count"; before: number; after: number }
  | {
      kind: "pricing";
      plan: string;
      currency: string | null;
      billingPeriod: string;
      before: number | null;
      after: number | null;
      more: number; // other plans that also changed/were added/removed
    }
  | { kind: "pricingCount"; before: number; after: number };

// Null unless this is a change row on a data source AND a meaningful delta exists
// (a prior batch is present and something actually moved). Falls back to null so the
// UI shows the snapshot summary instead.
function shapeCapturedDelta(r: RawRun): CapturedDelta | null {
  if (r.status !== "success" || !r.changeId) return null;

  if (r.sourceType === "jobs") {
    const after = r.jobsTotal ?? 0;
    const before = r.jobsPrevTotal;
    if (before == null || before === after) return null;
    return { kind: "jobs", before, after };
  }

  if (r.sourceType === "pricing") {
    const cur = Array.isArray(r.pricingPlans) ? r.pricingPlans : [];
    const prev = Array.isArray(r.pricingPrevPlans) ? r.pricingPrevPlans : [];
    if (prev.length === 0) return null;
    const prevMap = new Map(prev.map((p) => [planKey(p), p]));
    const curMap = new Map(cur.map((p) => [planKey(p), p]));
    const priceChanges = cur.flatMap((p) => {
      const q = prevMap.get(planKey(p));
      return q && p.price != null && q.price != null && p.price !== q.price
        ? [{ plan: p.planName, currency: p.currency, billingPeriod: p.billingPeriod, before: q.price, after: p.price }]
        : [];
    });
    if (priceChanges.length > 0) {
      const added = cur.filter((p) => !prevMap.has(planKey(p))).length;
      const removed = prev.filter((p) => !curMap.has(planKey(p))).length;
      const primary = priceChanges[0]!;
      return { kind: "pricing", ...primary, more: priceChanges.length - 1 + added + removed };
    }
    if (cur.length !== prev.length) {
      return { kind: "pricingCount", before: prev.length, after: cur.length };
    }
    return null;
  }

  if (/_reviews$/.test(r.sourceType)) {
    if (r.reviewPrevScore != null && r.reviewScore != null && r.reviewPrevScore !== r.reviewScore) {
      return { kind: "reviews", unit: "score", before: r.reviewPrevScore, after: r.reviewScore };
    }
    if (
      r.reviewPrevReviewCount != null &&
      r.reviewCount != null &&
      r.reviewPrevReviewCount !== r.reviewCount
    ) {
      return { kind: "reviews", unit: "count", before: r.reviewPrevReviewCount, after: r.reviewCount };
    }
    return null;
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

  // patch-28 — optional product scope (same as /health): the product's linked
  // competitors + its own self-product.
  const productId = c.req.query("productId");
  let comps = await orgCompetitors(orgId);
  if (productId) {
    const allowed = new Set(await scopedActivityIds(orgId, productId));
    comps = comps.filter((x) => allowed.has(x.id));
  }
  const nameById = new Map(comps.map((x) => [x.id, x.name]));
  const urlById = new Map(comps.map((x) => [x.id, x.url]));
  const colorById = new Map(comps.map((x) => [x.id, x.color]));
  const selfById = new Map(comps.map((x) => [x.id, x.type === "self"]));
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
           jobcap.by_dept AS "jobsByDept", jobcap.prev_total AS "jobsPrevTotal",
           pricecap.plan_count AS "pricingPlanCount", pricecap.min_price AS "pricingMinPrice",
           pricecap.max_price AS "pricingMaxPrice", pricecap.currency AS "pricingCurrency",
           pricecap.plans AS "pricingPlans", pricecap.prev_plans AS "pricingPrevPlans",
           reviewcap.score AS "reviewScore", reviewcap.review_count AS "reviewCount",
           reviewcap.subs AS "reviewSubs",
           reviewcap.prev_score AS "reviewPrevScore",
           reviewcap.prev_review_count AS "reviewPrevReviewCount"
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
    -- after scrape_runs is logged). Gated to status='success' runs: only those wrote
    -- a fresh snapshot and re-ran extraction, so the batch is genuinely this run's. A
    -- no_change run (hash dedup) extracts nothing — left null rather than carrying the
    -- last-known batch forward, which read as "still €14" repeating on every scrape.
    -- Batches are ≥1 day apart for these sources, so "latest <= run + 1h" uniquely
    -- picks the right one. Each LATERAL is also gated by source_type so a row never
    -- borrows another family's data.
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(jc.count), 0)::int AS total, count(*)::int AS teams,
             json_agg(json_build_object('department', jc.department, 'count', jc.count)
                      ORDER BY jc.count DESC) AS by_dept,
             -- Total roles in the batch BEFORE this run's (the one preceding cur_ts).
             -- NULL (not 0) when there is no prior batch → the UI shows no delta.
             (
               SELECT sum(jcp.count)::int FROM job_counts jcp
               WHERE jcp.competitor_id = r.competitor_id
                 AND jcp.recorded_at = (
                   SELECT max(jc3.recorded_at) FROM job_counts jc3
                   WHERE jc3.competitor_id = r.competitor_id
                     AND jc3.recorded_at < (
                       SELECT max(jc4.recorded_at) FROM job_counts jc4
                       WHERE jc4.competitor_id = r.competitor_id
                         AND jc4.recorded_at <= r.recorded_at + interval '1 hour'
                     )
                 )
             ) AS prev_total
      FROM job_counts jc
      WHERE jc.competitor_id = r.competitor_id
        AND jc.recorded_at = (
          SELECT max(jc2.recorded_at) FROM job_counts jc2
          WHERE jc2.competitor_id = r.competitor_id
            AND jc2.recorded_at <= r.recorded_at + interval '1 hour'
        )
    ) jobcap ON r.source_type = 'jobs' AND r.status = 'success'
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS plan_count,
             min(ph.price) FILTER (WHERE ph.price > 0) AS min_price,
             max(ph.price) AS max_price, max(ph.currency) AS currency,
             json_agg(json_build_object('planName', ph.plan_name, 'price', ph.price,
                                        'currency', ph.currency, 'billingPeriod', ph.billing_period)
                      ORDER BY ph.price NULLS LAST) AS plans,
             -- The plan rows from the batch BEFORE this run's, to diff price moves /
             -- plan add-removes against. NULL when there is no prior batch.
             (
               SELECT json_agg(json_build_object('planName', php.plan_name, 'price', php.price,
                                                 'currency', php.currency, 'billingPeriod', php.billing_period))
               FROM pricing_history php
               WHERE php.competitor_id = r.competitor_id
                 AND php.recorded_at = (
                   SELECT max(ph3.recorded_at) FROM pricing_history ph3
                   WHERE ph3.competitor_id = r.competitor_id
                     AND ph3.recorded_at < (
                       SELECT max(ph4.recorded_at) FROM pricing_history ph4
                       WHERE ph4.competitor_id = r.competitor_id
                         AND ph4.recorded_at <= r.recorded_at + interval '1 hour'
                     )
                 )
             ) AS prev_plans
      FROM pricing_history ph
      WHERE ph.competitor_id = r.competitor_id
        AND ph.recorded_at = (
          SELECT max(ph2.recorded_at) FROM pricing_history ph2
          WHERE ph2.competitor_id = r.competitor_id
            AND ph2.recorded_at <= r.recorded_at + interval '1 hour'
        )
    ) pricecap ON r.source_type = 'pricing' AND r.status = 'success'
    LEFT JOIN LATERAL (
      SELECT rs.score, rs.review_count,
             json_build_object('easeOfUse', rs.sub_ease_of_use, 'support', rs.sub_support,
                               'features', rs.sub_features, 'value', rs.sub_value) AS subs,
             -- The score / count from the batch BEFORE this run's, to show what moved.
             -- rs.recorded_at is this run's cur_ts (the WHERE-selected batch), so the
             -- prior batch is the max recorded_at strictly before it. Scalar subqueries
             -- in the SELECT list run once (post-WHERE/LIMIT), not per historical row.
             (
               SELECT rsp.score FROM review_scores rsp
               WHERE rsp.competitor_id = r.competitor_id
                 AND rsp.source = replace(r.source_type, '_reviews', '')
                 AND rsp.recorded_at = (
                   SELECT max(rs3.recorded_at) FROM review_scores rs3
                   WHERE rs3.competitor_id = r.competitor_id
                     AND rs3.source = replace(r.source_type, '_reviews', '')
                     AND rs3.recorded_at < rs.recorded_at
                 )
               LIMIT 1
             ) AS prev_score,
             (
               SELECT rsp.review_count FROM review_scores rsp
               WHERE rsp.competitor_id = r.competitor_id
                 AND rsp.source = replace(r.source_type, '_reviews', '')
                 AND rsp.recorded_at = (
                   SELECT max(rs3.recorded_at) FROM review_scores rs3
                   WHERE rs3.competitor_id = r.competitor_id
                     AND rs3.source = replace(r.source_type, '_reviews', '')
                     AND rs3.recorded_at < rs.recorded_at
                 )
               LIMIT 1
             ) AS prev_review_count
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
    ) reviewcap ON r.source_type ~ '_reviews$' AND r.status = 'success'
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
    competitorColor: colorById.get(r.competitorId) ?? null,
    isSelf: selfById.get(r.competitorId) ?? false,
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
    // On a change row, what moved vs the previous capture (delta); null elsewhere,
    // where the UI keeps the full snapshot (captured) instead.
    capturedDelta: shapeCapturedDelta(r),
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
