import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, snapshots, reviews, monitors } from "@outrival/db";
import { extractReviews, summarizeSource } from "@outrival/ai";
import { getFromR2, parseAppStoreSnapshot } from "@outrival/shared";
import { htmlToText } from "../lib/html-to-text";
import { insertReviewScore, getPreviousReviewScore } from "../lib/clickhouse";

const SourceEnum = z.enum(["g2", "capterra", "appstore", "playstore"]);

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

    // App Store snapshots are our normalized JSON (Apple RSS), not HTML. Score
    // and review_count come straight from the structured data; the AI is used
    // only to synthesize qualitative praises/complaints.
    let text: string;
    let structured: { averageScore: number | null; reviewCount: number } | null = null;
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
    }

    const extractedRaw = await extractReviews(text);
    if (!extractedRaw) {
      logger.warn("Reviews extraction returned null");
      return { ok: false, reason: "parse_failed" };
    }
    const extracted = structured
      ? {
          ...extractedRaw,
          average_score: structured.averageScore ?? extractedRaw.average_score,
          review_count: structured.reviewCount,
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
      source: "g2" | "capterra" | "appstore" | "playstore";
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

    if (verbatims.length > 0) {
      await db.insert(reviews).values(verbatims);
    }

    // Prior score before inserting the fresh one → summary can note the trend.
    const previousScore = await getPreviousReviewScore(input.competitorId, input.source);

    await insertReviewScore({
      competitor_id: input.competitorId,
      source: input.source,
      score: extracted.average_score ?? 0,
      review_count: extracted.review_count ?? 0,
      sentiment_score: extracted.sentiment_score,
      recorded_at: now,
    });

    const summary = await summarizeSource({
      kind: "reviews",
      source: input.source,
      score: extracted.average_score,
      reviewCount: extracted.review_count,
      sentiment: extracted.sentiment_score,
      praises: extracted.top_praises,
      complaints: extracted.top_complaints,
      previousScore,
    });
    if (summary) {
      await db
        .update(monitors)
        .set({ aiSummary: summary.summary, aiSummaryUpdatedAt: new Date() })
        .where(eq(monitors.id, snapshot.monitorId));
    }

    logger.log("Completed extract-reviews", {
      competitorId: input.competitorId,
      verbatimsInserted: verbatims.length,
    });
    return { ok: true, verbatimsInserted: verbatims.length };
  },
});
