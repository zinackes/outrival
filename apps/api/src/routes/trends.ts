import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { competitors } from "@outrival/db";
import { db } from "../lib/db";
import { analyticsQuery, sql } from "../lib/analytics-safe";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const trendsRouter = new Hono<{ Variables: Variables }>();

trendsRouter.use("*", authMiddleware);

// Consumption cockpit (Phase A) — cross-competitor trend reads over the time-series
// tables. Those tables are competitor-keyed and org-agnostic (no org_id, no FK), so
// every read first resolves the org's own competitor IDs relationally and filters the
// analytics by `competitor_id in (...)` — which is also what enforces tenant isolation.
// All analytics reads go through analyticsQuery (best-effort: a widget degrades to an
// empty state, never a 500). The window is capped (anticipates the deferred
// historyRetentionDays purge). See docs/consumption-cockpit.md.

function parseWindow(raw?: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 365) : 90;
}

const DAY_MS = 86_400_000;

// Resolve the analytics window. An explicit from/to (ISO) wins (custom date-range
// picker); otherwise fall back to the rolling `window` days. Guards against an
// invalid/inverted range by reverting to a 90-day window.
function resolveRange(fromRaw?: string, toRaw?: string, windowRaw?: string): {
  from: Date;
  to: Date;
} {
  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw ? new Date(fromRaw) : new Date(Date.now() - parseWindow(windowRaw) * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return { from: new Date(Date.now() - 90 * DAY_MS), to: new Date() };
  }
  return { from, to };
}

async function orgCompetitors(orgId: string) {
  return db
    .select({ id: competitors.id, name: competitors.name })
    .from(competitors)
    .where(and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)));
}

interface RawPricingMove {
  competitorId: string;
  planName: string;
  price: number;
  prevPrice: number | null;
  currency: string;
  billingPeriod: string;
  recordedAt: string;
}
interface RawHiringMove {
  competitorId: string;
  latest: number;
  earliest: number;
  net: number;
}
interface RawReviewMove {
  competitorId: string;
  source: string;
  score: number;
  reviewCount: number;
  recordedAt: string;
}
interface RawTechMove {
  competitorId: string;
  techId: string;
  event: string;
  importance: string;
  recordedAt: string;
}

// Cross-competitor leaderboards for the trends landing.
trendsRouter.get("/summary", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const { from, to } = resolveRange(c.req.query("from"), c.req.query("to"), c.req.query("window"));
  const windowDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));

  const comps = await orgCompetitors(orgId);
  const nameById = new Map(comps.map((x) => [x.id, x.name]));
  const ids = comps.map((x) => x.id);
  if (ids.length === 0) {
    return c.json({ window: windowDays, pricing: [], hiring: [], reviews: [], tech: [] });
  }
  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

  // Recent price changes (a plan's price differs from its previous batch).
  const pricing = await analyticsQuery<RawPricingMove>(sql`
    WITH ranked AS (
      SELECT competitor_id, plan_name, price, currency, billing_period, recorded_at,
             lag(price) OVER (
               PARTITION BY competitor_id, plan_name, billing_period ORDER BY recorded_at
             ) AS prev_price
      FROM pricing_history
      WHERE competitor_id IN (${idList})
        AND recorded_at >= ${from} AND recorded_at <= ${to}
    )
    SELECT competitor_id AS "competitorId", plan_name AS "planName", price,
           prev_price AS "prevPrice", currency, billing_period AS "billingPeriod",
           recorded_at AS "recordedAt"
    FROM ranked
    WHERE prev_price IS NOT NULL AND price <> prev_price
    ORDER BY recorded_at DESC
    LIMIT 50
  `);

  // Net open roles added over the window (latest total − earliest total).
  const hiring = await analyticsQuery<RawHiringMove>(sql`
    WITH totals AS (
      SELECT competitor_id, recorded_at, sum(count)::int AS total
      FROM job_counts
      WHERE competitor_id IN (${idList})
        AND recorded_at >= ${from} AND recorded_at <= ${to}
      GROUP BY competitor_id, recorded_at
    ),
    bounds AS (
      SELECT competitor_id,
             (array_agg(total ORDER BY recorded_at DESC))[1] AS latest,
             (array_agg(total ORDER BY recorded_at ASC))[1] AS earliest
      FROM totals
      GROUP BY competitor_id
    )
    SELECT competitor_id AS "competitorId", latest, earliest, (latest - earliest) AS net
    FROM bounds
    ORDER BY abs(latest - earliest) DESC, latest DESC
    LIMIT 50
  `);

  // Latest score per (competitor, source).
  const reviews = await analyticsQuery<RawReviewMove>(sql`
    SELECT DISTINCT ON (competitor_id, source)
           competitor_id AS "competitorId", source, score, review_count AS "reviewCount",
           recorded_at AS "recordedAt"
    FROM review_scores
    WHERE competitor_id IN (${idList})
      AND recorded_at >= ${from} AND recorded_at <= ${to}
    ORDER BY competitor_id, source, recorded_at DESC
    LIMIT 100
  `);

  // Recent tech appeared/disappeared across all competitors.
  const tech = await analyticsQuery<RawTechMove>(sql`
    SELECT competitor_id AS "competitorId", tech_id AS "techId", event, importance,
           recorded_at AS "recordedAt"
    FROM tech_stack_history
    WHERE competitor_id IN (${idList})
      AND recorded_at >= ${from} AND recorded_at <= ${to}
    ORDER BY recorded_at DESC
    LIMIT 50
  `);

  const withName = <T extends { competitorId: string }>(rows: T[]) =>
    rows.map((r) => ({ ...r, competitorName: nameById.get(r.competitorId) ?? "Unknown" }));

  return c.json({
    window: windowDays,
    pricing: withName(pricing),
    hiring: withName(hiring),
    reviews: withName(reviews),
    tech: withName(tech),
  });
});

const SERIES_METRICS = ["pricing", "hiring", "reviews"] as const;
type SeriesMetric = (typeof SERIES_METRICS)[number];
interface SeriesPoint {
  t: string;
  key: string;
  value: number;
}

// Time-series for one competitor + metric (the drill-down chart). `key` is the line
// grouping (plan / department / review source); the client pivots into multi-line.
trendsRouter.get("/series", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const { from, to } = resolveRange(c.req.query("from"), c.req.query("to"), c.req.query("window"));
  const competitorId = c.req.query("competitorId") ?? "";
  const metricParam = c.req.query("metric") ?? "";
  if (!competitorId || !(SERIES_METRICS as readonly string[]).includes(metricParam)) {
    return c.json({ error: "bad_request" }, 400);
  }
  const metric = metricParam as SeriesMetric;

  // Ownership check — never let an org pull another org's competitor series.
  const owns = await db.query.competitors.findFirst({
    where: and(
      eq(competitors.id, competitorId),
      eq(competitors.orgId, orgId),
      isNull(competitors.deletedAt),
    ),
    columns: { id: true },
  });
  if (!owns) return c.json({ error: "not_found" }, 404);

  let points: SeriesPoint[] = [];
  if (metric === "pricing") {
    points = await analyticsQuery<SeriesPoint>(sql`
      SELECT recorded_at AS "t", plan_name AS "key", price AS "value"
      FROM pricing_history
      WHERE competitor_id = ${competitorId}
        AND recorded_at >= ${from} AND recorded_at <= ${to}
      ORDER BY recorded_at ASC
    `);
  } else if (metric === "hiring") {
    points = await analyticsQuery<SeriesPoint>(sql`
      SELECT recorded_at AS "t", department AS "key", count AS "value"
      FROM job_counts
      WHERE competitor_id = ${competitorId}
        AND recorded_at >= ${from} AND recorded_at <= ${to}
      ORDER BY recorded_at ASC
    `);
  } else {
    points = await analyticsQuery<SeriesPoint>(sql`
      SELECT recorded_at AS "t", source AS "key", score AS "value"
      FROM review_scores
      WHERE competitor_id = ${competitorId}
        AND recorded_at >= ${from} AND recorded_at <= ${to}
      ORDER BY recorded_at ASC
    `);
  }

  return c.json({ metric, competitorId, points });
});
