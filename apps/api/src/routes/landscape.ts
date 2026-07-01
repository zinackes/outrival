import { Hono } from "hono";
import { and, eq, ne, isNull, inArray } from "drizzle-orm";
import { competitors, monitors, jobPostings } from "@outrival/db";
import { getFromR2 } from "@outrival/shared";
import { db } from "../lib/db";
import { analyticsQueryResult, sql } from "../lib/analytics-safe";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { primaryProductId, productCompetitorIds, productSelfCompetitorId } from "../lib/products";
import {
  computeLandscapeInsights,
  type InsightPricingRow,
  type LandscapeInsight,
} from "../lib/landscape-insights";

type Variables = { user: { id: string } };

export const landscapeRouter = new Hono<{ Variables: Variables }>();

landscapeRouter.use("*", authMiddleware);

// Day-0 competitive landscape (docs/post-onboarding-activation.md, Lever 1).
// "Here is where you stand today", assembled entirely from first-scrape data —
// no diff, no signal, no AI call. Everything is best-effort: a missing section
// renders empty, never a 500. All tiers (this is the activation surface).

// Internal anchor sources — never user-meaningful as "monitored sources" lights.
const INTERNAL_SOURCES = new Set(["tech_stack", "sitemap", "news", "ai_visibility"]);

const NEWS_FETCH_CAP = 10; // R2 reads per request — bounded, cached 60s
const NEWS_PER_COMPETITOR = 3;
const NEWS_TOTAL_CAP = 12;

interface NewsIslandItem {
  title?: string;
  link?: string | null;
  publishedAt?: string | null;
  source?: string | null;
}

// The news scraper embeds its structured items as a JSON island
// (packages/scrapers/src/news/news.ts buildNewsDoc) — parse it back out.
function parseNewsIsland(html: string): NewsIslandItem[] {
  const m = html.match(
    /<script type="application\/json" id="outrival-news-items">([\s\S]*?)<\/script>/,
  );
  const raw = m?.[1];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { items?: NewsIslandItem[] };
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

landscapeRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  // First scrapes land within minutes of onboarding; a short private cache keeps
  // the 30s client poll cheap without going stale.
  c.header("Cache-Control", "private, max-age=25");

  // Roster: the org's competitors (self excluded — it renders as "You").
  const productId = c.req.query("productId");
  let comps = await db
    .select({
      id: competitors.id,
      name: competitors.name,
      url: competitors.url,
      color: competitors.color,
      category: competitors.category,
      overlapScore: competitors.overlapScore,
      aiSummary: competitors.aiSummary,
    })
    .from(competitors)
    .where(
      and(
        eq(competitors.orgId, orgId),
        isNull(competitors.deletedAt),
        ne(competitors.type, "self"),
      ),
    );
  if (productId) {
    const allowed = new Set(await productCompetitorIds(orgId, productId));
    comps = comps.filter((x) => allowed.has(x.id));
  }

  const empty = {
    competitors: [],
    self: null,
    pricing: [],
    selfPricing: [],
    hiring: [],
    reviews: [],
    recentActivity: [],
    sources: [],
    insights: [] as LandscapeInsight[],
    nextCheckAt: null,
    degraded: false,
  };
  if (comps.length === 0) return c.json(empty);

  const ids = comps.map((x) => x.id);
  const nameById = new Map(comps.map((x) => [x.id, x.name]));

  // The user's own product anchors the "vs you" comparisons. Tenant-safe via the
  // products.orgId filter inside the helpers (a forged productId yields null).
  const scopeProductId = productId ?? (await primaryProductId(orgId));
  const selfCompetitorId = scopeProductId
    ? await productSelfCompetitorId(orgId, scopeProductId)
    : null;
  const selfRow = selfCompetitorId
    ? await db.query.competitors.findFirst({
        where: eq(competitors.id, selfCompetitorId),
        columns: { id: true, name: true, url: true },
      })
    : null;

  const pricingIds = selfRow ? [...ids, selfRow.id] : ids;
  const idList = sql.join(pricingIds.map((id) => sql`${id}`), sql`, `);

  const [pricingRes, reviewsRes, hiringRows, monitorRows, newsKeysRes] = await Promise.all([
    // Latest captured pricing per competitor: rows from the most recent extraction
    // batch (a batch's rows share recorded_at to within minutes), deduped per
    // (plan, billing period) so removed plans don't resurrect.
    analyticsQueryResult<InsightPricingRow & { recordedAt: string }>(sql`
      WITH latest AS (
        SELECT competitor_id, max(recorded_at) AS ts
        FROM pricing_history
        WHERE competitor_id IN (${idList})
        GROUP BY competitor_id
      )
      SELECT DISTINCT ON (ph.competitor_id, ph.plan_name, ph.billing_period)
             ph.competitor_id AS "competitorId", ph.plan_name AS "planName",
             ph.price, ph.currency, ph.billing_period AS "billingPeriod",
             ph.has_trial AS "hasTrial", ph.trial_days AS "trialDays",
             (ph.recorded_at AT TIME ZONE 'UTC') AS "recordedAt"
      FROM pricing_history ph
      JOIN latest l ON l.competitor_id = ph.competitor_id
      WHERE ph.recorded_at > l.ts - interval '15 minutes'
      ORDER BY ph.competitor_id, ph.plan_name, ph.billing_period, ph.recorded_at DESC
    `),

    // Latest review standing per (competitor, source).
    analyticsQueryResult<{
      competitorId: string;
      source: string;
      score: number;
      reviewCount: number;
    }>(sql`
      SELECT DISTINCT ON (competitor_id, source)
             competitor_id AS "competitorId", source, score, review_count AS "reviewCount"
      FROM review_scores
      WHERE competitor_id IN (${idList})
      ORDER BY competitor_id, source, recorded_at DESC
    `),

    // Currently-open roles per competitor + department (relational, dated data —
    // "recent activity" the first jobs scrape already carries).
    db
      .select({
        competitorId: jobPostings.competitorId,
        department: jobPostings.department,
        count: sql<number>`count(*)::int`,
      })
      .from(jobPostings)
      .where(and(inArray(jobPostings.competitorId, ids), eq(jobPostings.isActive, true)))
      .groupBy(jobPostings.competitorId, jobPostings.department),

    // Monitors → per-source progress lights + the honest "next change check" ETA.
    db
      .select({
        competitorId: monitors.competitorId,
        sourceType: monitors.sourceType,
        isActive: monitors.isActive,
        lastRunAt: monitors.lastRunAt,
        nextRunAt: monitors.nextRunAt,
        markedUnscrapable: monitors.markedUnscrapable,
      })
      .from(monitors)
      .where(inArray(monitors.competitorId, ids)),

    // Latest successful news snapshot per competitor — its JSON island carries
    // dated events (funding, launches, press) from the very first scrape.
    analyticsQueryResult<{ competitorId: string; r2Key: string }>(sql`
      SELECT DISTINCT ON (m.competitor_id)
             m.competitor_id AS "competitorId", sn.r2_key AS "r2Key"
      FROM monitors m
      JOIN snapshots sn ON sn.monitor_id = m.id
      WHERE m.competitor_id IN (${idList})
        AND m.source_type = 'news'
        AND sn.status = 'success'
      ORDER BY m.competitor_id, sn.scraped_at DESC
    `),
  ]);

  // Recent activity: pull each competitor's news island from R2 (bounded,
  // best-effort — a missing/unparseable snapshot just contributes nothing).
  const newsKeys = newsKeysRes.rows.slice(0, NEWS_FETCH_CAP);
  const newsBatches = await Promise.all(
    newsKeys.map(async (k) => {
      try {
        const html = await getFromR2(k.r2Key);
        return parseNewsIsland(html)
          .filter((it): it is NewsIslandItem & { title: string } => Boolean(it.title))
          .sort(
            (a, b) =>
              new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime(),
          )
          .slice(0, NEWS_PER_COMPETITOR)
          .map((it) => ({
            competitorId: k.competitorId,
            competitorName: nameById.get(k.competitorId) ?? "Unknown",
            title: it.title,
            link: it.link ?? null,
            source: it.source ?? null,
            publishedAt: it.publishedAt ?? null,
          }));
      } catch {
        return [];
      }
    }),
  );
  const recentActivity = newsBatches
    .flat()
    .sort(
      (a, b) => new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime(),
    )
    .slice(0, NEWS_TOTAL_CAP);

  // Hiring rollup: total open roles + top departments per competitor.
  const hiringByComp = new Map<string, { total: number; departments: Map<string, number> }>();
  for (const row of hiringRows) {
    const agg = hiringByComp.get(row.competitorId) ?? { total: 0, departments: new Map() };
    agg.total += row.count;
    if (row.department) {
      agg.departments.set(row.department, (agg.departments.get(row.department) ?? 0) + row.count);
    }
    hiringByComp.set(row.competitorId, agg);
  }
  const hiring = [...hiringByComp.entries()]
    .map(([competitorId, agg]) => ({
      competitorId,
      total: agg.total,
      departments: [...agg.departments.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([department, count]) => ({ department, count })),
    }))
    .sort((a, b) => b.total - a.total);

  // Per-source lights (internal anchors excluded) + the earliest upcoming check.
  const sources = monitorRows
    .filter((m) => !INTERNAL_SOURCES.has(m.sourceType))
    .map((m) => ({
      competitorId: m.competitorId,
      sourceType: m.sourceType,
      status: m.markedUnscrapable
        ? ("unavailable" as const)
        : m.lastRunAt
          ? ("captured" as const)
          : ("pending" as const),
    }));
  const nextCheckAt =
    monitorRows
      .filter((m) => m.isActive && !INTERNAL_SOURCES.has(m.sourceType) && m.nextRunAt)
      .map((m) => m.nextRunAt!.getTime())
      .sort((a, b) => a - b)[0] ?? null;

  const pricing = pricingRes.rows.filter((r) => r.competitorId !== selfRow?.id);
  const selfPricing = selfRow ? pricingRes.rows.filter((r) => r.competitorId === selfRow.id) : [];
  const reviews = reviewsRes.rows.filter((r) => r.competitorId !== selfRow?.id);

  const insights = computeLandscapeInsights({
    competitors: comps.map((x) => ({ id: x.id, name: x.name })),
    pricing,
    selfPricing,
    hiring: hiring.map((h) => ({
      competitorId: h.competitorId,
      total: h.total,
      topDepartment: h.departments[0]?.department ?? null,
    })),
    reviews,
  });

  return c.json({
    competitors: comps.map((x) => ({
      ...x,
      // Excerpt only — the full summary lives on the competitor page.
      aiSummary: x.aiSummary ? x.aiSummary.slice(0, 280) : null,
    })),
    self: selfRow ? { id: selfRow.id, name: selfRow.name, url: selfRow.url } : null,
    pricing,
    selfPricing,
    hiring,
    reviews,
    recentActivity,
    sources,
    insights,
    nextCheckAt: nextCheckAt ? new Date(nextCheckAt).toISOString() : null,
    degraded: !pricingRes.ok || !reviewsRes.ok,
  });
});
