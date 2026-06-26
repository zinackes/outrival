import { Hono } from "hono";
import { and, eq, isNull, inArray, desc } from "drizzle-orm";
import { competitors, signals, techStackEntries } from "@outrival/db";
import { type PlatformProfile, platformLabel } from "@outrival/shared";
import { db } from "../lib/db";
import { analyticsQuery, sql } from "../lib/analytics-safe";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const compareRouter = new Hono<{ Variables: Variables }>();

compareRouter.use("*", authMiddleware);

// Consumption cockpit (Phase A) — the N-way comparison matrix. Assembles a normalised
// per-competitor column server-side so the client stays dumb. Reads are scoped to the
// org (ids not owned by the caller are dropped); the analytics rows (pricing/hiring/
// reviews) go through analyticsQuery (best-effort → empty, never a 500). No new schema.
// See docs/consumption-cockpit.md.

const MAX_COLUMNS = 12;
const IMPORTANCE_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

// Surface the routed platforms (framework/cms/ats/hosting) for the "Stack" row.
// Values are stored as routable slugs ("next", "vercel") — label them with the
// proper brand name so they match the "Notable tech" catalog names. The ats field
// is "<provider>:<token>" (jobs routing key) — show the provider only. Returns null
// when nothing useful was detected.
function platformOf(p: PlatformProfile | null): PlatformDetail | null {
  if (!p) return null;
  const atsProvider = p.ats?.value ? p.ats.value.split(":")[0] : null;
  const detail: PlatformDetail = {
    framework: p.framework?.value ? platformLabel(p.framework.value) : null,
    cms: p.cms?.value ? platformLabel(p.cms.value) : null,
    ats: atsProvider ? platformLabel(atsProvider) : null,
    hosting: p.hosting?.value ? platformLabel(p.hosting.value) : null,
  };
  return detail.framework || detail.cms || detail.ats || detail.hosting ? detail : null;
}

// One pricing-history row from the latest batch (one per plan). Aggregated into
// a band (entry/top) for the compact cell + kept as `plans` for the detail view.
interface RawPricingPlan {
  competitorId: string;
  planName: string;
  price: number;
  currency: string | null;
  billingPeriod: string | null;
}
// One job_counts row from the latest batch (one per department).
interface RawHiringDept {
  competitorId: string;
  department: string;
  count: number;
}
interface RawReview {
  competitorId: string;
  source: string;
  score: number;
  reviewCount: number;
  ease: number | null;
  support: number | null;
  features: number | null;
  value: number | null;
}

interface PricingDetail {
  entry: number;
  top: number;
  currency: string | null;
  billingPeriod: string | null;
  plans: Array<{ name: string; price: number; billingPeriod: string | null }>;
}
interface HiringDetail {
  totalOpen: number;
  topDepartment: string | null;
  departments: Array<{ department: string; count: number }>;
}
interface ReviewDetail {
  source: string;
  score: number;
  reviewCount: number;
  sub: { ease: number; support: number; features: number; value: number } | null;
}
interface PlatformDetail {
  framework: string | null;
  cms: string | null;
  ats: string | null;
  hosting: string | null;
}

interface CompareColumn {
  id: string;
  name: string;
  url: string | null;
  positioning: { category: string | null; summary: string | null };
  pricing: PricingDetail | null;
  hiring: HiringDetail | null;
  reviews: ReviewDetail[];
  tech: string[];
  platform: PlatformDetail | null;
  latestSignal: { severity: string; createdAt: string } | null;
}

compareRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  // Heavy per-competitor analytics aggregate refreshed by hourly+ scrapes — a
  // short private cache trims repeat compute + Neon cold-wakes (F11).
  c.header("Cache-Control", "private, max-age=60");

  const requested = (c.req.query("competitorIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const dedup = [...new Set(requested)].slice(0, MAX_COLUMNS);
  if (dedup.length === 0) return c.json({ competitors: [] });

  // Only the caller's own, non-deleted competitors.
  const owned = await db
    .select({
      id: competitors.id,
      name: competitors.name,
      url: competitors.url,
      category: competitors.category,
      description: competitors.description,
      aiSummary: competitors.aiSummary,
      platformProfile: competitors.platformProfile,
    })
    .from(competitors)
    .where(
      and(
        eq(competitors.orgId, orgId),
        inArray(competitors.id, dedup),
        isNull(competitors.deletedAt),
      ),
    );
  if (owned.length === 0) return c.json({ competitors: [] });

  const ids = owned.map((c) => c.id);
  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

  // Relational: active tech + latest signal per competitor.
  const [techRows, latestSignals] = await Promise.all([
    db
      .select({
        competitorId: techStackEntries.competitorId,
        techName: techStackEntries.techName,
        importance: techStackEntries.importance,
      })
      .from(techStackEntries)
      .where(and(inArray(techStackEntries.competitorId, ids), eq(techStackEntries.isActive, true))),
    db
      .selectDistinctOn([signals.competitorId], {
        competitorId: signals.competitorId,
        severity: signals.severity,
        createdAt: signals.createdAt,
      })
      .from(signals)
      .where(and(eq(signals.orgId, orgId), inArray(signals.competitorId, ids)))
      .orderBy(signals.competitorId, desc(signals.createdAt)),
  ]);

  // Analytics (best-effort): the latest batch per competitor, kept row-level (one
  // row per plan / department / review source) so the client can render either a
  // compact summary or the per-plan / per-department / sub-score detail.
  const pricingPlans = await analyticsQuery<RawPricingPlan>(sql`
    WITH latest AS (
      SELECT competitor_id, max(recorded_at) AS rid
      FROM pricing_history WHERE competitor_id IN (${idList}) GROUP BY competitor_id
    )
    SELECT p.competitor_id AS "competitorId", p.plan_name AS "planName", p.price,
           p.currency, p.billing_period AS "billingPeriod"
    FROM pricing_history p
    JOIN latest l ON l.competitor_id = p.competitor_id AND p.recorded_at = l.rid
    ORDER BY p.competitor_id, p.price
  `);

  const hiringDepts = await analyticsQuery<RawHiringDept>(sql`
    WITH latest AS (
      SELECT competitor_id, max(recorded_at) AS rid
      FROM job_counts WHERE competitor_id IN (${idList}) GROUP BY competitor_id
    )
    SELECT j.competitor_id AS "competitorId", j.department, j.count::int AS count
    FROM job_counts j
    JOIN latest l ON l.competitor_id = j.competitor_id AND j.recorded_at = l.rid
    ORDER BY j.competitor_id, j.count DESC
  `);

  const reviews = await analyticsQuery<RawReview>(sql`
    SELECT DISTINCT ON (competitor_id, source)
           competitor_id AS "competitorId", source, score, review_count AS "reviewCount",
           sub_ease_of_use AS ease, sub_support AS support,
           sub_features AS features, sub_value AS value
    FROM review_scores WHERE competitor_id IN (${idList})
    ORDER BY competitor_id, source, recorded_at DESC
  `);

  // Index analytics by competitor — fold the row-level results into per-competitor
  // detail objects (band + plans, total + departments, score + sub-scores).
  const pricingById = new Map<string, PricingDetail>();
  for (const p of pricingPlans) {
    const cur = pricingById.get(p.competitorId);
    if (!cur) {
      pricingById.set(p.competitorId, {
        entry: p.price,
        top: p.price,
        currency: p.currency,
        billingPeriod: p.billingPeriod,
        plans: [{ name: p.planName, price: p.price, billingPeriod: p.billingPeriod }],
      });
    } else {
      cur.entry = Math.min(cur.entry, p.price);
      cur.top = Math.max(cur.top, p.price);
      cur.plans.push({ name: p.planName, price: p.price, billingPeriod: p.billingPeriod });
    }
  }

  const hiringById = new Map<string, HiringDetail>();
  for (const h of hiringDepts) {
    const cur = hiringById.get(h.competitorId);
    if (!cur) {
      hiringById.set(h.competitorId, {
        totalOpen: h.count,
        topDepartment: h.department,
        departments: [{ department: h.department, count: h.count }],
      });
    } else {
      cur.totalOpen += h.count;
      cur.departments.push({ department: h.department, count: h.count });
    }
  }

  const reviewsById = new Map<string, ReviewDetail[]>();
  for (const r of reviews) {
    const list = reviewsById.get(r.competitorId) ?? [];
    const sub =
      r.ease != null || r.support != null || r.features != null || r.value != null
        ? {
            ease: r.ease ?? 0,
            support: r.support ?? 0,
            features: r.features ?? 0,
            value: r.value ?? 0,
          }
        : null;
    list.push({ source: r.source, score: r.score, reviewCount: r.reviewCount, sub });
    reviewsById.set(r.competitorId, list);
  }
  const signalById = new Map(latestSignals.map((s) => [s.competitorId, s]));

  // Top notable active tech per competitor (by importance, deduped, capped).
  const techById = new Map<string, string[]>();
  for (const t of techRows) {
    const list = techById.get(t.competitorId) ?? [];
    list.push(t.techName);
    techById.set(t.competitorId, list);
  }
  const importanceOf = new Map(techRows.map((t) => [`${t.competitorId}::${t.techName}`, t.importance]));
  for (const [cid, names] of techById) {
    const top = [...new Set(names)]
      .sort(
        (a, b) =>
          (IMPORTANCE_ORDER[importanceOf.get(`${cid}::${a}`) ?? "low"] ?? 2) -
          (IMPORTANCE_ORDER[importanceOf.get(`${cid}::${b}`) ?? "low"] ?? 2),
      )
      .slice(0, 5);
    techById.set(cid, top);
  }

  const byId = new Map(owned.map((o) => [o.id, o]));
  // Preserve the caller's requested order.
  const columns: CompareColumn[] = dedup
    .filter((id) => byId.has(id))
    .map((id) => {
      const o = byId.get(id)!;
      const sig = signalById.get(id);
      const platform = platformOf(o.platformProfile);
      // Drop from "Notable tech" anything already shown in the "Stack" row (the two
      // detectors overlap on framework/hosting) so a tech never appears twice.
      const stackNames = new Set(
        [platform?.framework, platform?.cms, platform?.hosting, platform?.ats]
          .filter((v): v is string => Boolean(v))
          .map((v) => v.toLowerCase()),
      );
      const tech = (techById.get(id) ?? []).filter((t) => !stackNames.has(t.toLowerCase()));
      return {
        id: o.id,
        name: o.name,
        url: o.url,
        positioning: { category: o.category, summary: o.aiSummary ?? o.description },
        pricing: pricingById.get(id) ?? null,
        hiring: hiringById.get(id) ?? null,
        reviews: reviewsById.get(id) ?? [],
        tech,
        platform,
        latestSignal: sig
          ? { severity: sig.severity, createdAt: sig.createdAt as unknown as string }
          : null,
      };
    });

  return c.json({ competitors: columns });
});
