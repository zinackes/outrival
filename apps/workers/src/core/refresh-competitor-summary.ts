import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError } from "@outrival/queue";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, competitors, signals, reviews, monitors, snapshots } from "@outrival/db";
import { generateCompetitorSummary, AI_CONFIG } from "@outrival/ai";
import { getFromR2 } from "@outrival/shared";
import { isCloudflareChallenge } from "@outrival/scrapers/block-detection";
import { htmlToText } from "../lib/html-to-text";
import { loggedAi } from "../lib/analytics";
import { notifyJobComplete } from "../lib/job-complete";

const InputSchema = z.object({
  competitorId: z.string(),
  // Set by the on-demand refresh route → drop a durable "summary ready" notification
  // when the refresh lands. Automated triggers (post-scrape / onboarding /
  // battle-card) omit it and stay silent.
  notifyOnComplete: z.boolean().optional(),
});

// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/refresh-competitor-summary.job.ts (deleted at the
// cutover). The body is byte-identical to the pre-migration job — only the
// header and the signature change, so the two runtimes cannot drift.
export async function runRefreshCompetitorSummary(payload: z.input<typeof InputSchema>) {
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
          // Defence-in-depth: a stored snapshot can be an anti-bot challenge shell
          // that slipped past the cascade's detection. Feeding it to the model
          // yields a summary that describes the security check ("the site is
          // showing a security check…") instead of the product. Drop it so the
          // summary falls back to signals/profile rather than parroting junk.
          if (isCloudflareChallenge(html)) {
            logger.warn("Homepage snapshot is an anti-bot challenge — skipping as summary input", {
              competitorId: competitor.id,
            });
          } else {
            homepageContent = htmlToText(html).slice(0, 8000);
          }
        } catch (err) {
          logger.warn("Failed to load homepage snapshot for summary", { err: String(err) });
        }
      }
    }

    const result = await loggedAi(
      "competitor_summary",
      AI_CONFIG.classification,
      () =>
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
      { orgId: competitor.orgId, competitorId: competitor.id },
    );

    if (!result) {
      // null = the model returned non-empty but UNPARSEABLE output (logged as
      // ai_runs=parse_failed) — not an empty/throttled completion, which throws
      // upstream. Returning ok:false here swallowed the miss → no Trigger retry →
      // the competitor stayed stuck "analyzing" (aiSummary is the onboarding
      // readiness proxy) until the next scheduled scrape self-healed hours later
      // (the "1/N ready" bug). Throw so Trigger re-rolls (maxAttempts 3): a fresh
      // generation / provider failover almost always parses.
      throw new Error(`Competitor summary unparseable for ${competitor.id} — retrying`);
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

    if (input.notifyOnComplete) {
      await notifyJobComplete({
        orgId: competitor.orgId,
        title: `${competitor.name}'s summary is ready`,
        body: "The refreshed AI competitive summary is ready to view.",
        linkUrl: `/dashboard/competitors/${competitor.id}`,
      });
    }

    logger.log("Completed refresh-competitor-summary", { competitorId: competitor.id });
    return { ok: true, summary: result.summary };
}
