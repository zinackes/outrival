import { task, logger, queue, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, competitors, signals, reviews, monitors, snapshots } from "@outrival/db";
import { generateCompetitorSummary, AI_CONFIG } from "@outrival/ai";
import { getFromR2 } from "@outrival/shared";
import { htmlToText } from "../lib/html-to-text";
import { loggedAi } from "../lib/analytics";

const InputSchema = z.object({
  competitorId: z.string(),
});

// Onboarding /complete fires every competitor's homepage scrape at once, so this
// job fans out N-wide a few seconds apart. Hitting the shared AI provider pool
// all at once throttled it — one summary then stalled ~56s or hit MAX_DURATION and
// never landed, leaving its competitor stuck "analyzing" until the next scheduled
// scrape self-healed (hours/days later). A bounded queue serialises the burst so
// each call keeps the provider to itself (~3s). Env-tunable for paid AI tiers.
const summaryQueue = queue({
  name: "competitor-summary",
  concurrencyLimit: Number(process.env.SUMMARY_CONCURRENCY ?? 3),
});

export const refreshCompetitorSummaryJob = task({
  id: "refresh-competitor-summary",
  queue: summaryQueue,
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

    // Pull the latest homepage capture so the summary reflects what the
    // competitor actually does — not just signals/reviews, which are empty for a
    // freshly added competitor. Best-effort: fall back to signals/reviews on miss.
    let homepageContent: string | null = null;
    const homepageMonitor = await db.query.monitors.findFirst({
      where: and(eq(monitors.competitorId, competitor.id), eq(monitors.sourceType, "homepage")),
    });
    if (homepageMonitor) {
      const latestSnapshot = await db.query.snapshots.findFirst({
        where: eq(snapshots.monitorId, homepageMonitor.id),
        orderBy: desc(snapshots.scrapedAt),
      });
      if (latestSnapshot) {
        try {
          const html = await getFromR2(`${latestSnapshot.r2Key}.html`);
          homepageContent = htmlToText(html).slice(0, 8000);
        } catch (err) {
          logger.warn("Failed to load homepage snapshot for summary", { err: String(err) });
        }
      }
    }

    const result = await loggedAi("competitor_summary", AI_CONFIG.classification, () =>
      generateCompetitorSummary({
      name: competitor.name,
      category: competitor.category ?? null,
      description: competitor.description,
      homepageContent,
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
      }),
    );

    if (!result) {
      logger.warn("Competitor summary generation returned null");
      return { ok: false };
    }

    // category is AI-derived (no manual edit path); refresh it whenever the model
    // returns a non-empty label, otherwise keep whatever is already there.
    const nextCategory = result.category?.trim();
    await db
      .update(competitors)
      .set({
        aiSummary: result.summary,
        aiSummaryUpdatedAt: new Date(),
        ...(nextCategory ? { category: nextCategory } : {}),
      })
      .where(eq(competitors.id, competitor.id));

    logger.log("Completed refresh-competitor-summary", { competitorId: competitor.id });
    return { ok: true, summary: result.summary };
  },
});
