import { schedules, logger } from "@trigger.dev/sdk/v3";
import { and, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import {
  db,
  organizations,
  competitors,
  signals,
  jobPostings,
  sectoralSignals,
  type SectoralEvidence,
} from "@outrival/db";
import {
  detectFeatureTrends,
  detectHiringTrends,
  detectPricingTrends,
  detectPositioningShifts,
  formulateSectoralSignal,
  type CompetitorSectoralData,
  type DetectedPattern,
} from "@outrival/ai";
import {
  getPricingHistorySince,
  getPricingStatusHistorySince,
} from "../lib/analytics";
import { validateWorkerEnv } from "../env";

// Feature/hiring/positioning look at recent moves; pricing needs a longer window
// to see a trajectory. Pricing data is fetched for 90 days and each detector
// applies its own window.
const RECENT_DAYS = 30;
const PRICING_DAYS = 90;
const DEDUPE_DAYS = 7;

function periodStartFor(category: DetectedPattern["category"]): Date {
  const days = category === "pricing_trend" ? PRICING_DAYS : RECENT_DAYS;
  return new Date(Date.now() - days * 86_400_000);
}

async function loadOrgSectoralData(
  orgId: string,
  comps: Array<{ id: string; name: string }>,
): Promise<CompetitorSectoralData[]> {
  const ids = comps.map((c) => c.id);
  const recentSince = new Date(Date.now() - RECENT_DAYS * 86_400_000);

  // Postgres: classified `product` signals (features) + recent job postings.
  const productSignals = await db
    .select({
      competitorId: signals.competitorId,
      insight: signals.insight,
      soWhat: signals.soWhat,
      createdAt: signals.createdAt,
    })
    .from(signals)
    .where(
      and(
        eq(signals.orgId, orgId),
        eq(signals.category, "product"),
        gte(signals.createdAt, recentSince),
      ),
    );

  const jobs =
    ids.length > 0
      ? await db
          .select({
            competitorId: jobPostings.competitorId,
            title: jobPostings.title,
            department: jobPostings.department,
            detectedAt: jobPostings.detectedAt,
          })
          .from(jobPostings)
          .where(
            and(
              inArray(jobPostings.competitorId, ids),
              gte(jobPostings.detectedAt, recentSince),
            ),
          )
      : [];

  // Analytics (best-effort): price + status history. null → empty (detectors skip).
  const pricing = (await getPricingHistorySince(ids, PRICING_DAYS)) ?? [];
  const statuses = (await getPricingStatusHistorySince(ids, PRICING_DAYS)) ?? [];

  return comps.map((c) => ({
    id: c.id,
    name: c.name,
    productSignals: productSignals
      .filter((s) => s.competitorId === c.id)
      .map((s) => ({ insight: s.insight, soWhat: s.soWhat, createdAt: s.createdAt })),
    jobs: jobs
      .filter((j) => j.competitorId === c.id)
      .map((j) => ({ title: j.title, department: j.department, detectedAt: j.detectedAt })),
    pricePoints: pricing
      .filter((p) => p.competitor_id === c.id)
      .map((p) => ({ planName: p.plan_name, price: p.price, recordedAt: new Date(p.recorded_at) })),
    statusTimeline: statuses
      .filter((p) => p.competitor_id === c.id)
      .map((p) => ({ status: p.status, recordedAt: new Date(p.recorded_at) })),
  }));
}

export const analyzeSectoralJob = schedules.task({
  id: "analyze-sectoral",
  // Monday 07:00 UTC. SECTORAL_ANALYSIS_DAY documents intent but the cron is static.
  cron: "0 7 * * 1",
  maxDuration: 600,

  async run() {
    const env = validateWorkerEnv();
    const minCompetitors = env.SECTORAL_MIN_COMPETITORS;
    const minConfidence = env.SECTORAL_MIN_CONFIDENCE;

    logger.log("Starting analyze-sectoral", { minCompetitors, minConfidence });

    const orgs = await db.query.organizations.findMany({
      where: eq(organizations.onboardingCompleted, true),
    });

    let analyzed = 0;
    let totalSignals = 0;

    for (const org of orgs) {
      try {
        const created = await analyzeOneOrg(org, minCompetitors, minConfidence);
        if (created >= 0) analyzed++;
        totalSignals += Math.max(created, 0);
      } catch (err) {
        // Never let one org block the others.
        logger.error("Sectoral analysis failed for org", { orgId: org.id, err: String(err) });
      }
    }

    logger.log("Completed analyze-sectoral", { orgs: orgs.length, analyzed, totalSignals });
    return { orgs: orgs.length, analyzed, signals: totalSignals };
  },
});

async function analyzeOneOrg(
  org: typeof organizations.$inferSelect,
  minCompetitors: number,
  minConfidence: number,
): Promise<number> {
  const comps = await db
    .select({ id: competitors.id, name: competitors.name })
    .from(competitors)
    .where(
      and(
        eq(competitors.orgId, org.id),
        isNull(competitors.deletedAt),
        ne(competitors.type, "self"),
      ),
    );

  if (comps.length < minCompetitors) {
    logger.log("Not enough competitors for sectoral analysis, skipping", {
      orgId: org.id,
      competitors: comps.length,
      minCompetitors,
    });
    return -1;
  }

  const data = await loadOrgSectoralData(org.id, comps);

  const patterns = [
    ...detectFeatureTrends(data, RECENT_DAYS),
    ...detectHiringTrends(data, RECENT_DAYS),
    ...detectPricingTrends(data, PRICING_DAYS),
    ...detectPositioningShifts(data, RECENT_DAYS),
  ];

  const significant = patterns.filter((p) => p.confidence >= minConfidence);
  if (significant.length === 0) {
    logger.log("No significant sectoral patterns", { orgId: org.id, detected: patterns.length });
    return 0;
  }

  // Idempotence: skip a pattern already published for this org in the last week
  // (matched on the stable evidence.metric, not the AI-formulated title).
  const since = new Date(Date.now() - DEDUPE_DAYS * 86_400_000);
  const recent = await db
    .select({ evidence: sectoralSignals.evidence })
    .from(sectoralSignals)
    .where(and(eq(sectoralSignals.orgId, org.id), gte(sectoralSignals.createdAt, since)));
  const recentMetrics = new Set(
    recent.map((r) => (r.evidence as SectoralEvidence | null)?.metric).filter(Boolean),
  );

  let created = 0;
  for (const pattern of significant) {
    if (recentMetrics.has(pattern.evidence.metric)) {
      logger.log("Sectoral pattern already published this week, skipping", {
        orgId: org.id,
        metric: pattern.evidence.metric,
      });
      continue;
    }

    const draft = await formulateSectoralSignal(pattern, {
      category: org.productProfile?.category ?? "",
      audience: org.productProfile?.audience ?? "",
    });

    // Replaces the absent patch-02 ai_runs log: one structured line per formulation.
    logger.log("formulate_sectoral", {
      orgId: org.id,
      category: pattern.category,
      metric: pattern.evidence.metric,
      confidence: pattern.confidence,
      status: draft ? "success" : "parse_failed",
    });

    if (!draft) continue;

    await db.insert(sectoralSignals).values({
      orgId: org.id,
      category: pattern.category,
      title: draft.title,
      insight: draft.insight,
      evidence: pattern.evidence,
      confidence: pattern.confidence.toFixed(2),
      periodStart: periodStartFor(pattern.category),
      periodEnd: new Date(),
    });
    created++;
  }

  logger.log("Sectoral analysis completed", { orgId: org.id, created });
  return created;
}
