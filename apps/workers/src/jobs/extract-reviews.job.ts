import { task, logger, tasks, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, snapshots, reviews, monitors } from "@outrival/db";
import { extractReviews, summarizeSource, AI_CONFIG } from "@outrival/ai";
import { getFromR2, parseAppStoreSnapshot } from "@outrival/shared";
import { reviewScoresFromStructured } from "@outrival/scrapers/structured-data";
import { isCloudflareChallenge } from "@outrival/scrapers/block-detection";
import { htmlToText } from "../lib/html-to-text";
import { insertReviewScore, getPreviousReviewScore, loggedAi } from "../lib/analytics";

const SourceEnum = z.enum([
  "g2", "capterra", "appstore", "playstore",
  // patch-32 — additional review platforms (web pages, structured-first score path).
  "trustpilot", "trustradius", "gartner",
]);
type ReviewSource = z.infer<typeof SourceEnum>;

const InputSchema = z.object({
  snapshotId: z.string(),
  competitorId: z.string(),
  source: SourceEnum,
});

export const extractReviewsJob = task({
  id: "extract-reviews",
  maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const input = InputSchema.parse(payload);
    logger.log("Starting extract-reviews", input);

    const snapshot = await db.query.snapshots.findFirst({
      where: eq(snapshots.id, input.snapshotId),
    });
    if (!snapshot) throw new AbortTaskRunError(`Snapshot ${input.snapshotId} not found`);

    const html = await getFromR2(`${snapshot.r2Key}.html`);

    // R7: an anti-bot interstitial served at HTTP 200 passes the cascade but is NOT
    // the reviews page. Reject it here so the LLM never hallucinates an
    // average_score / verbatims from the challenge shell and writes them to
    // review_scores (there's no structured AggregateRating on a challenge page to
    // override it). App Store snapshots are our normalized JSON — they never carry
    // these HTML challenge markers, so that path is unaffected.
    if (isCloudflareChallenge(html)) {
      logger.warn("Reviews page is an anti-bot challenge — skipping extraction", {
        source: input.source,
        snapshotId: input.snapshotId,
      });
      return { ok: false, reason: "blocked_challenge" };
    }

    // App Store snapshots are our normalized JSON (Apple RSS), not HTML. Score
    // and review_count come straight from the structured data; the AI is used
    // only to synthesize qualitative praises/complaints.
    let text: string;
    let structured: { averageScore: number | null; reviewCount: number | null } | null = null;
    if (input.source === "appstore") {
      const summary = parseAppStoreSnapshot(html);
      if (!summary) {
        logger.warn("App Store snapshot parse failed");
        return { ok: false, reason: "parse_failed" };
      }
      if (summary.reviewCount === 0 || summary.text.length === 0) {
        logger.warn("App Store snapshot has no reviews");
        return { ok: false, reason: "no_reviews" };
      }
      text = summary.text;
      structured = { averageScore: summary.averageScore, reviewCount: summary.reviewCount };
    } else {
      text = htmlToText(html);
      // Structured-first scores (patch-30): G2/Capterra ship schema.org
      // AggregateRating — trust those numbers over the LLM's. The qualitative
      // summary (sentiment, praises, complaints) still needs AI, so this enriches
      // rather than replaces. Null fields fall back to the AI values below.
      const scores = reviewScoresFromStructured(html);
      if (scores && (scores.average_score !== null || scores.review_count !== null)) {
        structured = { averageScore: scores.average_score, reviewCount: scores.review_count };
      }
    }

    const extractedRaw = await loggedAi(
      "extract_reviews",
      AI_CONFIG.classification,
      () => extractReviews(text),
      { competitorId: input.competitorId },
    );
    if (!extractedRaw) {
      logger.warn("Reviews extraction returned null");
      return { ok: false, reason: "parse_failed" };
    }
    const extracted = structured
      ? {
          ...extractedRaw,
          average_score: structured.averageScore ?? extractedRaw.average_score,
          review_count: structured.reviewCount ?? extractedRaw.review_count,
        }
      : extractedRaw;
    logger.log("Reviews extracted", {
      source: input.source,
      averageScore: extracted.average_score,
      reviewCount: extracted.review_count,
      sentiment: extracted.sentiment_score,
      praises: extracted.top_praises.length,
      complaints: extracted.top_complaints.length,
    });

    const now = new Date();
    const verbatims: Array<{
      competitorId: string;
      source: ReviewSource;
      content: string;
      author: string;
      score: number | null;
      detectedAt: Date;
    }> = [];
    for (const praise of extracted.top_praises) {
      verbatims.push({
        competitorId: input.competitorId,
        source: input.source,
        content: praise,
        author: "praise",
        score: extracted.average_score,
        detectedAt: now,
      });
    }
    for (const complaint of extracted.top_complaints) {
      verbatims.push({
        competitorId: input.competitorId,
        source: input.source,
        content: complaint,
        author: "complaint",
        score: extracted.average_score,
        detectedAt: now,
      });
    }

    // Prior score before inserting the fresh one → summary can note the trend.
    const previousScore = await getPreviousReviewScore(input.competitorId, input.source);

    // Retry-safety: run the throwing AI call (and the monitor update it feeds)
    // BEFORE the non-idempotent inserts below, so a retried run after an AI
    // failure never leaves duplicate verbatims/scores behind.
    const summary = await loggedAi(
      "source_summary",
      AI_CONFIG.classificationFast,
      () =>
        summarizeSource({
          kind: "reviews",
          source: input.source,
          score: extracted.average_score,
          reviewCount: extracted.review_count,
          sentiment: extracted.sentiment_score,
          praises: extracted.top_praises,
          complaints: extracted.top_complaints,
          previousScore,
          subScores: extracted.sub_scores,
          themes: extracted.complaint_themes,
        }),
      { competitorId: input.competitorId },
    );
    if (summary) {
      await db
        .update(monitors)
        .set({ aiSummary: summary.summary, aiSummaryUpdatedAt: new Date() })
        .where(eq(monitors.id, snapshot.monitorId));
    }

    if (verbatims.length > 0) {
      await db.insert(reviews).values(verbatims);
    }

    // Only record a star-score time-series point when there IS a rating — a scrape
    // that found verbatims but no AggregateRating would pollute the score trend with
    // a 0/5, so it carries sentiment + themes via the verbatims + summary instead.
    if (extracted.average_score != null) {
      await insertReviewScore({
        competitor_id: input.competitorId,
        source: input.source,
        score: extracted.average_score,
        review_count: extracted.review_count ?? 0,
        sentiment_score: extracted.sentiment_score,
        sub_ease_of_use: extracted.sub_scores?.ease_of_use ?? null,
        sub_support: extracted.sub_scores?.support ?? null,
        sub_features: extracted.sub_scores?.features ?? null,
        sub_value: extracted.sub_scores?.value ?? null,
        complaint_themes: extracted.complaint_themes ?? null,
        recorded_at: now,
      });

      // A fresh scored row with clustered complaint themes may reveal a rising theme
      // (a competitive opening) — evaluate the sliding-window inflection off the
      // pipeline (no cron slot). Fire-and-forget; keyed on the snapshot so a job retry
      // doesn't re-trigger. Never blocks the extraction.
      if ((extracted.complaint_themes?.length ?? 0) > 0) {
        try {
          await tasks.trigger(
            "detect-review-theme-shifts",
            { competitorId: input.competitorId },
            { idempotencyKey: `rts-${input.competitorId}-${input.snapshotId}` },
          );
        } catch (err) {
          logger.warn("detect-review-theme-shifts trigger failed (non-fatal)", {
            error: String(err),
          });
        }
      }
    }

    logger.log("Completed extract-reviews", {
      competitorId: input.competitorId,
      verbatimsInserted: verbatims.length,
    });
    return { ok: true, verbatimsInserted: verbatims.length };
  },
});
