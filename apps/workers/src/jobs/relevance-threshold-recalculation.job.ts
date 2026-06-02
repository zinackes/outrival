import { schedules, logger } from "@trigger.dev/sdk/v3";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, qualityFeedback, signals, orgRelevanceThreshold } from "@outrival/db";

interface OrgStats {
  useful: number[];
  notUseful: number[];
  total: number;
}

function average(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Patch-26 layer 1, learning half: weekly, per org, derive the relevance threshold
// from the org's signal feedback (patch-21) — the midpoint between the average
// relevance of "useful" and "not_useful" signals. Needs enough data on both sides;
// clamped to [0.2, 0.8] to avoid extremes. Orgs without enough feedback keep the
// default 0.5.
export const relevanceThresholdRecalculationJob = schedules.task({
  id: "relevance-threshold-recalculation",
  cron: "0 3 * * 0", // Sundays 03:00 UTC
  maxDuration: 300,
  retry: { maxAttempts: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000, factor: 2 },

  async run() {
    const minFeedbacks = Number(process.env.RELEVANCE_AUTO_ADJUST_MIN_FEEDBACKS ?? 10);

    // Every signal feedback whose signal carries a relevance score, with its org.
    const rows = await db
      .select({
        orgId: qualityFeedback.orgId,
        verdict: qualityFeedback.verdict,
        score: signals.relevanceScore,
      })
      .from(qualityFeedback)
      .innerJoin(signals, eq(qualityFeedback.targetId, signals.id))
      .where(
        and(
          eq(qualityFeedback.targetType, "signal"),
          isNotNull(signals.relevanceScore),
        ),
      );

    const byOrg = new Map<string, OrgStats>();
    for (const r of rows) {
      if (r.score == null) continue;
      const stats = byOrg.get(r.orgId) ?? { useful: [], notUseful: [], total: 0 };
      stats.total++;
      if (r.verdict === "useful") stats.useful.push(r.score);
      else if (r.verdict === "not_useful") stats.notUseful.push(r.score);
      byOrg.set(r.orgId, stats);
    }

    let adjusted = 0;
    let insufficient = 0;

    for (const [orgId, stats] of byOrg) {
      if (stats.total < minFeedbacks || stats.useful.length < 3 || stats.notUseful.length < 3) {
        insufficient++;
        continue;
      }

      const midpoint = (average(stats.useful) + average(stats.notUseful)) / 2;
      const threshold = Math.max(0.2, Math.min(0.8, midpoint));

      await db
        .insert(orgRelevanceThreshold)
        .values({
          orgId,
          threshold,
          source: "auto_adjusted",
          feedbackCountAtCalc: stats.total,
          lastRecalculatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: orgRelevanceThreshold.orgId,
          set: {
            threshold,
            source: "auto_adjusted",
            feedbackCountAtCalc: stats.total,
            lastRecalculatedAt: new Date(),
          },
        });
      adjusted++;
    }

    logger.log("Completed relevance-threshold-recalculation", {
      adjusted,
      insufficient,
      orgs: byOrg.size,
    });
    return { adjusted, insufficient };
  },
});
