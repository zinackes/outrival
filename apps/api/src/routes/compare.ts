import { Hono } from "hono";
import { and, eq, ne, isNull, inArray, desc } from "drizzle-orm";
import { competitors, signals, techStackEntries } from "@outrival/db";
import {
  type PlatformProfile,
  platformLabel,
  resolveCurrentPricing,
  isComparablePricePeriod,
  type PricingTier,
  type CompetitorOverrides,
  normalizeDepartment,
  cheapestCostAtVolume,
  meteredUnits,
  pricingModelOf,
  REFERENCE_VOLUME_PRESETS,
  type MeteredRow,
  type PricingModel,
  type TierBandRow,
} from "@outrival/shared";
import { organizations } from "@outrival/db";
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

// Engineering share read off the raw job_counts labels, for a competitor no
// authoritative ATS run ever bucketed (the LLM/careers path writes job_counts but
// never hiring_metrics). Same normalizer the worker runs, minus the job titles it
// cannot see here — so a label that says "Engineering" counts, and one that says
// nothing stays out. Returns null rather than 0 when no label buckets to
// engineering: that capture can be partial, and "no engineering hiring" is a
// stronger claim than the data supports.
function engineeringFromLabels(rows: Array<{ department: string; count: number }>): number | null {
  let engineering = 0;
  for (const r of rows) {
    if (normalizeDepartment(r.department, null, null) === "engineering") engineering += r.count;
  }
  return engineering > 0 ? engineering : null;
}

// One pricing-history row from the latest batch (one per plan). Aggregated into
// a band (entry/top) for the compact cell + kept as `plans` for the detail view.
interface RawPricingPlan {
  competitorId: string;
  planName: string;
  // null for quote-based tiers (Enterprise / Custom).
  price: number | null;
  currency: string | null;
  billingPeriod: string | null;
  // Only present on detected rows — a manual override has no capture time.
  recordedAt?: string | null;
  // P3 — what the row meters and how it charges. Only on detected rows: a
  // manual override edits a subscription price, never a rate structure.
  unit?: string | null;
  includedQuantity?: number | null;
  rateStructure?: string | null;
  minimumAmount?: number | null;
  percentageRate?: number | null;
}
// One job_counts row from the latest batch (one per department).
interface RawHiringDept {
  competitorId: string;
  department: string;
  count: number;
  recordedAt: string | null;
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
  recordedAt: string | null;
}

// One price_tiers row of the latest batch, in the shape the shared differ and
// cost model already read.
interface RawPriceTier extends TierBandRow {
  competitorId: string;
}

/** What buying `qty` of `unit` from this competitor costs per month. */
interface MeterCostDetail {
  unit: string;
  qty: number;
  cost: number;
  currency: string | null;
  planName: string;
}

interface PricingDetail {
  // null when the competitor exposes only quote-based tiers (no public number).
  entry: number | null;
  top: number | null;
  currency: string | null;
  billingPeriod: string | null;
  plans: Array<{
    name: string;
    price: number | null;
    billingPeriod: string | null;
    // P3 — what a usage/per-seat price applies to, so the lens can group a
    // competitor's metered plans by meter without re-reading the page.
    unit: string | null;
  }>;
  // When the batch these plans come from was captured — the provenance line under
  // an expanded price row. Null on a competitor whose plans are all manual overrides.
  capturedAt: string | null;
  // P3 — how this competitor charges, and what it costs at the volumes this
  // workspace compares at. Computed ON READ from the captured ladder, so a
  // workspace changing its reference volumes never needs a re-capture.
  model: PricingModel | null;
  meters: MeterCostDetail[];
}
interface HiringDetail {
  totalOpen: number;
  topDepartment: string | null;
  departments: Array<{ department: string; count: number }>;
  // Open roles in the canonical `engineering` bucket. The compare page picks this
  // share out of the total bar, because it is the share that says what a competitor
  // is building. hiring_metrics first (authoritative ATS run, bucketed with the
  // titles); otherwise the raw job_counts labels are bucketed by the same
  // normalizer. Null when neither yields engineering roles.
  engineeringOpen: number | null;
  capturedAt: string | null;
}
interface ReviewDetail {
  source: string;
  score: number;
  reviewCount: number;
  sub: { ease: number; support: number; features: number; value: number } | null;
  recordedAt: string | null;
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
  // The competitor's last move, in the words the feed uses. The compare page leads
  // its "Latest move" lens with `insight`, so a severity word and a date (all this
  // used to carry) is not enough — `id` deep-links the row to the signal.
  latestSignal: {
    id: string;
    severity: string;
    category: string;
    insight: string;
    createdAt: string;
  } | null;
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
      overrides: competitors.overrides,
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
        id: signals.id,
        severity: signals.severity,
        category: signals.category,
        insight: signals.insight,
        createdAt: signals.createdAt,
      })
      .from(signals)
      .where(and(eq(signals.orgId, orgId), inArray(signals.competitorId, ids)))
      .orderBy(signals.competitorId, desc(signals.createdAt)),
  ]);

  // Analytics (best-effort): the latest batch per competitor, kept row-level (one
  // row per plan / department / review source) so the client can render either a
  // compact summary or the per-plan / per-department / sub-score detail.
  const detectedPlans = await analyticsQuery<RawPricingPlan>(sql`
    WITH latest AS (
      SELECT competitor_id, max(recorded_at) AS rid
      FROM pricing_history WHERE competitor_id IN (${idList}) GROUP BY competitor_id
    )
    SELECT p.competitor_id AS "competitorId", p.plan_name AS "planName", p.price,
           p.currency, p.billing_period AS "billingPeriod", p.recorded_at AS "recordedAt",
           p.unit, p.included_quantity AS "includedQuantity",
           p.rate_structure AS "rateStructure", p.minimum_amount AS "minimumAmount",
           p.percentage_rate AS "percentageRate"
    FROM pricing_history p
    JOIN latest l ON l.competitor_id = p.competitor_id AND p.recorded_at = l.rid
    ORDER BY p.competitor_id, p.price
  `);

  // The published ladders of the same batches — what makes a metered plan
  // priceable at a volume instead of readable as a bare rate.
  const tierRows = await analyticsQuery<RawPriceTier>(sql`
    WITH latest AS (
      SELECT competitor_id, max(recorded_at) AS rid
      FROM price_tiers WHERE competitor_id IN (${idList}) GROUP BY competitor_id
    )
    SELECT t.competitor_id AS "competitorId", t.plan_name, t.unit,
           t.from_qty, t.to_qty, t.unit_price, t.flat_fee
    FROM price_tiers t
    JOIN latest l ON l.competitor_id = t.competitor_id AND t.recorded_at = l.rid
    ORDER BY t.competitor_id, t.plan_name, t.from_qty
  `);
  // Apply each competitor's per-plan overlay so a hand-edited/added/hidden plan
  // shows in the comparison grid too, not just its own pricing tab. Grouped by
  // competitor, resolved against that competitor's overrides, re-flattened —
  // iterating over all owned ids so a competitor with only manual plans still shows.
  const overridesById = new Map(
    owned.map((o) => [o.id, (o.overrides ?? null) as CompetitorOverrides | null]),
  );
  const plansByComp = new Map<string, RawPricingPlan[]>();
  for (const p of detectedPlans) {
    const arr = plansByComp.get(p.competitorId);
    if (arr) arr.push(p);
    else plansByComp.set(p.competitorId, [p]);
  }
  const pricingPlans: RawPricingPlan[] = [];
  for (const cid of ids) {
    const detectedTiers: PricingTier[] = (plansByComp.get(cid) ?? []).map((p) => ({
      planName: p.planName,
      price: p.price,
      currency: p.currency ?? "USD",
      billingPeriod: p.billingPeriod ?? "monthly",
    }));
    for (const r of resolveCurrentPricing(detectedTiers, overridesById.get(cid) ?? null)) {
      pricingPlans.push({
        competitorId: cid,
        planName: r.planName,
        price: r.price,
        currency: r.currency,
        billingPeriod: r.billingPeriod,
      });
    }
  }

  const hiringDepts = await analyticsQuery<RawHiringDept>(sql`
    WITH latest AS (
      SELECT competitor_id, max(recorded_at) AS rid
      FROM job_counts WHERE competitor_id IN (${idList}) GROUP BY competitor_id
    )
    SELECT j.competitor_id AS "competitorId", j.department, j.count::int AS count,
           j.recorded_at AS "recordedAt"
    FROM job_counts j
    JOIN latest l ON l.competitor_id = j.competitor_id AND j.recorded_at = l.rid
    ORDER BY j.competitor_id, j.count DESC
  `);

  const reviews = await analyticsQuery<RawReview>(sql`
    SELECT DISTINCT ON (competitor_id, source)
           competitor_id AS "competitorId", source, score, review_count AS "reviewCount",
           sub_ease_of_use AS ease, sub_support AS support,
           sub_features AS features, sub_value AS value,
           recorded_at AS "recordedAt"
    FROM review_scores WHERE competitor_id IN (${idList})
    ORDER BY competitor_id, source, recorded_at DESC
  `);

  // Engineering share of the open roles, from the canonical buckets the ATS path
  // writes weekly. Deliberately a separate read from job_counts: that table holds
  // the raw ATS labels ("Platform Engineering", "R&D"). Missing here (LLM/careers
  // fallback, no ATS run) → the labels are bucketed below instead.
  const engineeringRows = await analyticsQuery<{ competitorId: string; openCount: number }>(sql`
    WITH latest AS (
      SELECT competitor_id, max(week_start) AS w
      FROM hiring_metrics WHERE competitor_id IN (${idList}) GROUP BY competitor_id
    )
    SELECT h.competitor_id AS "competitorId", h.open_count::int AS "openCount"
    FROM hiring_metrics h
    JOIN latest l ON l.competitor_id = h.competitor_id AND h.week_start = l.w
    WHERE h.department_bucket = 'engineering'
  `);
  const engineeringById = new Map(engineeringRows.map((r) => [r.competitorId, r.openCount]));

  // Index analytics by competitor — fold the row-level results into per-competitor
  // detail objects (band + plans, total + departments, score + sub-scores).
  // Capture time of the detected batch, kept before the override resolution below
  // (resolveCurrentPricing returns resolved tiers, which carry no recorded_at).
  const pricingCapturedAt = new Map<string, string>();
  for (const p of detectedPlans) {
    if (p.recordedAt && !pricingCapturedAt.has(p.competitorId)) {
      pricingCapturedAt.set(p.competitorId, p.recordedAt);
    }
  }

  const pricingById = new Map<string, PricingDetail>();
  for (const p of pricingPlans) {
    let cur = pricingById.get(p.competitorId);
    if (!cur) {
      cur = {
        entry: null,
        top: null,
        currency: p.currency,
        billingPeriod: p.billingPeriod,
        plans: [],
        capturedAt: pricingCapturedAt.get(p.competitorId) ?? null,
        model: null,
        meters: [],
      };
      pricingById.set(p.competitorId, cur);
    }
    cur.plans.push({
      name: p.planName,
      price: p.price,
      billingPeriod: p.billingPeriod,
      unit: p.unit ?? null,
    });
    // The entry/top band is numeric AND comparable-only: quote-based tiers (price
    // null) and usage rates ($0.10 / API call) join the plan list but never the band
    // — you can't min/max a per-call rate against a monthly subscription price.
    if (p.price != null && isComparablePricePeriod(p.billingPeriod)) {
      cur.entry = cur.entry == null ? p.price : Math.min(cur.entry, p.price);
      cur.top = cur.top == null ? p.price : Math.max(cur.top, p.price);
    }
  }

  // P3 — how each competitor charges, and what its meters cost at the volumes
  // this workspace compares at. Read off the DETECTED rows (a manual override
  // edits a subscription price, never a rate structure), minus any plan the
  // overlay hides — a hidden plan must not quote a cost.
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { referenceVolumes: true },
  });
  const workspaceVolumes = org?.referenceVolumes ?? null;
  const tiersByComp = new Map<string, TierBandRow[]>();
  for (const t of tierRows) {
    const list = tiersByComp.get(t.competitorId) ?? [];
    list.push(t);
    tiersByComp.set(t.competitorId, list);
  }

  for (const [competitorId, detail] of pricingById) {
    const visible = new Set(detail.plans.map((p) => p.name));
    const rows: MeteredRow[] = (plansByComp.get(competitorId) ?? [])
      .filter((p) => visible.has(p.planName))
      .map((p) => ({
        plan_name: p.planName,
        price: p.price,
        currency: p.currency,
        billing_period: p.billingPeriod ?? "monthly",
        unit: p.unit ?? null,
        included_quantity: p.includedQuantity ?? null,
        rate_structure: p.rateStructure ?? null,
        minimum_amount: p.minimumAmount ?? null,
        percentage_rate: p.percentageRate ?? null,
      }));
    if (rows.length === 0) continue;

    detail.model = pricingModelOf(rows);
    const ladders = tiersByComp.get(competitorId) ?? [];
    for (const unit of meteredUnits(rows)) {
      // The workspace's own volumes for this meter, or the presets when it has
      // named none — the setting narrows the ladder, it does not replace it.
      const own = (workspaceVolumes ?? []).filter((v) => v.unit === unit).map((v) => v.qty);
      const quantities = own.length > 0 ? own : REFERENCE_VOLUME_PRESETS;
      for (const qty of quantities) {
        const best = cheapestCostAtVolume(rows, ladders, unit, qty);
        if (!best) continue;
        detail.meters.push({
          unit,
          qty,
          cost: best.cost,
          currency: best.currency,
          planName: best.planName,
        });
      }
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
        engineeringOpen: null,
        capturedAt: h.recordedAt,
      });
    } else {
      cur.totalOpen += h.count;
      cur.departments.push({ department: h.department, count: h.count });
    }
  }
  for (const [competitorId, detail] of hiringById) {
    detail.engineeringOpen =
      engineeringById.get(competitorId) ?? engineeringFromLabels(detail.departments);
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
    list.push({
      source: r.source,
      score: r.score,
      reviewCount: r.reviewCount,
      sub,
      recordedAt: r.recordedAt,
    });
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
          ? {
              id: sig.id,
              severity: sig.severity,
              category: sig.category,
              insight: sig.insight,
              createdAt: sig.createdAt as unknown as string,
            }
          : null,
      };
    });

  return c.json({ competitors: columns });
});

// Picker ranking — a per-competitor "data completeness" score (0-6) so the default
// columns + the picker surface the competitors that actually have data to compare
// side-by-side (and, on ties, the best overlap — applied client-side). The six
// dimensions map 1:1 to the compare table rows: positioning, platform, tech,
// pricing, hiring, reviews. Cheap existence checks; the analytics dimensions are
// best-effort (missing → simply not counted, never a 500). Org-wide (the client
// only reads ids in its scoped picker); short private cache like the matrix.
compareRouter.get("/ranking", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  c.header("Cache-Control", "private, max-age=60");

  const owned = await db
    .select({
      id: competitors.id,
      aiSummary: competitors.aiSummary,
      platformProfile: competitors.platformProfile,
    })
    .from(competitors)
    .where(
      and(
        eq(competitors.orgId, orgId),
        isNull(competitors.deletedAt),
        ne(competitors.type, "self"),
      ),
    );
  if (owned.length === 0) return c.json({ ranking: {} });

  const ids = owned.map((o) => o.id);
  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

  const techRows = await db
    .selectDistinct({ competitorId: techStackEntries.competitorId })
    .from(techStackEntries)
    .where(and(inArray(techStackEntries.competitorId, ids), eq(techStackEntries.isActive, true)));
  const hasTech = new Set(techRows.map((t) => t.competitorId));

  // Best-effort analytics existence sets (empty on error → that dimension is just
  // not counted for anyone, so the ranking degrades to overlap order — never fails).
  const [pricingIds, hiringIds, reviewIds] = await Promise.all([
    analyticsQuery<{ competitorId: string }>(
      sql`SELECT DISTINCT competitor_id AS "competitorId" FROM pricing_history WHERE competitor_id IN (${idList})`,
    ),
    analyticsQuery<{ competitorId: string }>(
      sql`SELECT DISTINCT competitor_id AS "competitorId" FROM job_counts WHERE competitor_id IN (${idList})`,
    ),
    analyticsQuery<{ competitorId: string }>(
      sql`SELECT DISTINCT competitor_id AS "competitorId" FROM review_scores WHERE competitor_id IN (${idList})`,
    ),
  ]);
  const hasPricing = new Set(pricingIds.map((r) => r.competitorId));
  const hasHiring = new Set(hiringIds.map((r) => r.competitorId));
  const hasReviews = new Set(reviewIds.map((r) => r.competitorId));

  const ranking: Record<string, number> = {};
  for (const o of owned) {
    ranking[o.id] =
      (o.aiSummary ? 1 : 0) +
      (o.platformProfile ? 1 : 0) +
      (hasTech.has(o.id) ? 1 : 0) +
      (hasPricing.has(o.id) ? 1 : 0) +
      (hasHiring.has(o.id) ? 1 : 0) +
      (hasReviews.has(o.id) ? 1 : 0);
  }
  return c.json({ ranking });
});
