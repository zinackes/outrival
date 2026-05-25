import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, competitors, signals, reviews } from "@outrival/db";
import { generateCompetitorSummary } from "@outrival/ai";

const InputSchema = z.object({
  competitorId: z.string(),
});

export const refreshCompetitorSummaryJob = task({
  id: "refresh-competitor-summary",
  maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const input = InputSchema.parse(payload);
    logger.log("Starting refresh-competitor-summary", input);

    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, input.competitorId),
    });
    if (!competitor) throw new AbortTaskRunError(`Competitor ${input.competitorId} not found`);

    const recentSignals = await db.query.signals.findMany({
      where: eq(signals.competitorId, competitor.id),
      orderBy: desc(signals.createdAt),
      limit: 8,
    });

    const recentComplaints = await db.query.reviews.findMany({
      where: and(eq(reviews.competitorId, competitor.id), eq(reviews.author, "complaint")),
      orderBy: desc(reviews.detectedAt),
      limit: 5,
    });

    const reviewScore = recentComplaints[0]?.score ?? null;

    const result = await generateCompetitorSummary({
      name: competitor.name,
      category: competitor.category ?? null,
      description: competitor.description,
      recentSignals: recentSignals.map((s) => ({
        category: s.category,
        severity: s.severity,
        insight: s.insight,
      })),
      reviewSummary: recentComplaints.length
        ? {
            score: reviewScore,
            topComplaints: recentComplaints.map((r) => r.content ?? "").filter(Boolean),
          }
        : undefined,
    });

    if (!result) {
      logger.warn("Competitor summary generation returned null");
      return { ok: false };
    }

    await db
      .update(competitors)
      .set({ aiSummary: result.summary, aiSummaryUpdatedAt: new Date() })
      .where(eq(competitors.id, competitor.id));

    logger.log("Completed refresh-competitor-summary", { competitorId: competitor.id });
    return { ok: true, summary: result.summary };
  },
});
