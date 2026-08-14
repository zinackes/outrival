import { logger } from "../lib/job-logger";
import { NonRetriable as AbortTaskRunError, detectReviewThemeShifts } from "@outrival/queue";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, snapshots, reviews, monitors, competitors } from "@outrival/db";
import { extractReviews, summarizeSource, AI_CONFIG } from "@outrival/ai";
import {
  getFromR2,
  parseAppStoreSnapshot,
  parseShopifyReviewsSnapshot,
  parseTrustpilotSnapshot,
} from "@outrival/shared";
import { reviewScoresFromStructured } from "@outrival/scrapers/structured-data";
import { isCloudflareChallenge } from "@outrival/scrapers/block-detection";
import { htmlToText } from "../lib/html-to-text";
import { insertReviewScore, getPreviousReviewPoint, loggedAi } from "../lib/analytics";
import {
  checkBrandPresence,
  checkCapturedTarget,
  checkReviewsStructure,
  checkScoreRegression,
  type ReviewsRefusal,
} from "../lib/reviews-authenticity";

const SourceEnum = z.enum([
  "g2", "capterra", "appstore", "playstore",
  // patch-32 — additional review platforms (web pages, structured-first score path).
  "trustpilot", "trustradius", "gartner",
  // 2026-08-04 — Shopify App Store. Like appstore, its snapshot is our normalized
  // JSON (not HTML), so it takes the structured branch below rather than htmlToText.
  "shopify",
]);
type ReviewSource = z.infer<typeof SourceEnum>;

const InputSchema = z.object({
  snapshotId: z.string(),
  competitorId: z.string(),
  source: SourceEnum,
});

/**
 * Proxy sentiment for a score-only capture: no verbatims ⇒ no AI-judged sentiment,
 * so map the 1–5 rating onto the 0–100 scale the not-null column expects.
 */
function sentimentFromRating(score: number): number {
  return Math.max(0, Math.min(100, Math.round(((score - 1) / 4) * 100)));
}

/**
 * Persist the star-rating time-series point on a run that never reached the AI.
 *
 * The score and the review count are STRUCTURED data — Apple's Lookup API for the
 * App Store, schema.org AggregateRating for a review page — parsed before any model
 * is called. They used to be written only at the very end of the happy path, so an
 * empty verbatim feed or a single AI parse failure threw away a rating we already
 * held, and the Reviews tab then reported "no data" for a competitor whose rating
 * had been captured on every scrape.
 *
 * Carries the R7 anti-regression guard so no caller can write a point around it:
 * returns the refusal instead of writing, null when the point was stored.
 */
async function persistAggregateOnly(args: {
  competitorId: string;
  source: ReviewSource;
  score: number;
  reviewCount: number | null;
}): Promise<ReviewsRefusal | null> {
  const regression = checkScoreRegression(
    await getPreviousReviewPoint(args.competitorId, args.source),
    { score: args.score, reviewCount: args.reviewCount },
  );
  if (regression) return regression;
  await insertReviewScore({
    competitor_id: args.competitorId,
    source: args.source,
    score: args.score,
    review_count: args.reviewCount ?? 0,
    sentiment_score: sentimentFromRating(args.score),
    complaint_themes: null,
    recorded_at: new Date(),
  });
  return null;
}

/**
 * What a refused capture leaves behind (R7).
 *
 * Nothing is written to review_scores — the whole point — so the refusal has to be
 * legible somewhere else, and the snapshot is that place: `partial` with a zero
 * completeness is the same grade R6 gives a capture that is not the page it claims
 * to be, and it already keeps a row out of the diff baseline and out of extraction.
 * The reason itself lives in the log line and the return value: the table has no
 * column for it, and adding one to write a string nobody queries is not worth a
 * migration.
 */
async function refuseCapture(args: {
  snapshotId: string;
  competitorId: string;
  source: ReviewSource;
  refusal: ReviewsRefusal;
}): Promise<{ ok: false; reason: string }> {
  await db
    .update(snapshots)
    .set({ status: "partial", completeness: 0 })
    .where(eq(snapshots.id, args.snapshotId));
  logger.warn("Reviews capture refused — nothing written", {
    snapshotId: args.snapshotId,
    competitorId: args.competitorId,
    source: args.source,
    reason: args.refusal.reason,
    detail: args.refusal.detail,
  });
  return { ok: false, reason: args.refusal.reason };
}

// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/extract-reviews.job.ts (deleted at the cutover).
// Only the header, the signature and the fan-out calls change.
export async function runExtractReviews(payload: z.input<typeof InputSchema>) {
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
      return refuseCapture({
        snapshotId: input.snapshotId,
        competitorId: input.competitorId,
        source: input.source,
        refusal: { reason: "blocked_challenge", detail: "anti-bot interstitial served at 200" },
      });
    }

    // R7: is this the reviews page of the competitor we monitor?
    //
    // R6 grades the landing URL of own-domain sources at capture time and skips
    // reviews on purpose — a reviews profile legitimately lives on someone else's
    // domain. So the check happens here instead, on the identity the platform put in
    // the capture (Apple's app id, Shopify's handle, Trustpilot's domain) against the
    // one the monitor URL names. A point captured from another brand's profile reads
    // as a rating move, not as an error, and the score-drop detector turns it into a
    // signal nobody can trace back.
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, snapshot.monitorId),
    });
    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, input.competitorId),
    });
    // The monitor's own URL when it has one (a pinned profile), the competitor's site
    // otherwise — the same resolution scrape-monitor scrapes with.
    const configUrl =
      monitor?.config && typeof (monitor.config as { url?: unknown }).url === "string"
        ? String((monitor.config as { url: unknown }).url)
        : null;
    const intendedUrl = configUrl ?? competitor?.url ?? null;

    const targetRefusal = checkCapturedTarget({
      source: input.source,
      intendedUrl,
      finalUrl: snapshot.finalUrl ?? snapshot.resolvedUrl,
      payload: html,
    });
    if (targetRefusal) {
      return refuseCapture({
        snapshotId: input.snapshotId,
        competitorId: input.competitorId,
        source: input.source,
        refusal: targetRefusal,
      });
    }

    // Trustpilot public surface (Reviews v2): a structured score/count snapshot with
    // NO verbatims (their ToS forbids scraping them). Write the review_scores point
    // directly — no AI, no `reviews` rows, no complaint-theme shift (there are no
    // themes without verbatims; the Trustpilot signal rides the score-drop inflection
    // detector instead). Short-circuit before the AI verbatim path below.
    if (input.source === "trustpilot") {
      const summary = parseTrustpilotSnapshot(html);
      if (!summary) {
        logger.warn("Trustpilot snapshot parse failed");
        return { ok: false, reason: "parse_failed" };
      }
      if (summary.trustScore == null) {
        // A profile Trustpilot answers for with zero reviews is an ANSWER, not a
        // failed capture (R7 (c)): there is no point to plot, but the source is
        // healthy and the snapshot stays `success`. Only a capture that says nothing
        // at all — no score AND no count — is a refusal.
        if (summary.reviewCount === 0) {
          logger.log("Trustpilot profile has no reviews yet (explicit zero)", {
            competitorId: input.competitorId,
          });
          return { ok: true, verbatimsInserted: 0, empty: true };
        }
        logger.warn("Trustpilot snapshot has no score");
        return { ok: false, reason: "no_score" };
      }
      const trustpilotRegression = checkScoreRegression(
        await getPreviousReviewPoint(input.competitorId, "trustpilot"),
        { score: summary.trustScore, reviewCount: summary.reviewCount },
      );
      if (trustpilotRegression) {
        return refuseCapture({
          snapshotId: input.snapshotId,
          competitorId: input.competitorId,
          source: input.source,
          refusal: trustpilotRegression,
        });
      }
      const sentimentFromScore = sentimentFromRating(summary.trustScore);
      await insertReviewScore({
        competitor_id: input.competitorId,
        source: "trustpilot",
        score: summary.trustScore,
        review_count: summary.reviewCount,
        sentiment_score: sentimentFromScore,
        complaint_themes: null,
        recorded_at: new Date(),
      });
      // Evaluate the aggregate-score inflection off the pipeline (Reviews v2): a
      // sustained Trustpilot score drop is a "reviews" signal even without verbatims.
      // Fire-and-forget, keyed on the snapshot so a retry doesn't re-trigger.
      try {
        await detectReviewThemeShifts.enqueue(
          { competitorId: input.competitorId },
          { singletonKey: `rts-${input.competitorId}-${input.snapshotId}` },
        );
      } catch (err) {
        logger.warn("detect-review-theme-shifts trigger failed (non-fatal)", {
          error: String(err),
        });
      }

      logger.log("Completed extract-reviews (trustpilot surface)", {
        competitorId: input.competitorId,
        score: summary.trustScore,
        reviewCount: summary.reviewCount,
      });
      return { ok: true, verbatimsInserted: 0 };
    }

    // App Store and Shopify snapshots are our normalized JSON (Apple's RSS feed, the
    // Shopify listing's own markup), not HTML. Score and review_count come straight
    // from the structured data — Apple's Lookup aggregate, Shopify's JSON-LD
    // AggregateRating — and the AI is used only to synthesize qualitative
    // praises/complaints out of the verbatims.
    let text: string;
    let structured: { averageScore: number | null; reviewCount: number | null } | null = null;
    if (input.source === "appstore" || input.source === "shopify") {
      const label = input.source === "appstore" ? "App Store" : "Shopify";
      const summary =
        input.source === "appstore"
          ? parseAppStoreSnapshot(html)
          : parseShopifyReviewsSnapshot(html);
      if (!summary) {
        logger.warn(`${label} snapshot parse failed`);
        return { ok: false, reason: "parse_failed" };
      }
      if (summary.reviewCount === 0 || summary.text.length === 0) {
        // Both sources carry the aggregate separately from the verbatims: Apple's
        // Lookup call, Shopify's JSON-LD block. So a capture with no verbatim text
        // (an entry-less Apple feed — observed in prod as 124-byte snapshots holding
        // a valid 4.5/2506 aggregate — or a Shopify window of star-only reviews)
        // still holds the rating the tab is built on. Record it instead of dropping
        // the whole capture on the floor.
        if (summary.averageScore != null) {
          const refusal = await persistAggregateOnly({
            competitorId: input.competitorId,
            source: input.source,
            score: summary.averageScore,
            reviewCount: summary.reviewCount,
          });
          if (refusal) {
            return refuseCapture({
              snapshotId: input.snapshotId,
              competitorId: input.competitorId,
              source: input.source,
              refusal,
            });
          }
          logger.log(`Completed extract-reviews (${label} aggregate, no verbatims)`, {
            competitorId: input.competitorId,
            score: summary.averageScore,
            reviewCount: summary.reviewCount,
          });
          return { ok: true, verbatimsInserted: 0 };
        }
        // A listing the platform answers for with zero reviews is an explicit empty
        // state (R7 (c)), not a failed capture: no rating to plot, but the source is
        // healthy — the snapshot stays `success` and nothing is graded partial.
        if (summary.reviewCount === 0) {
          logger.log(`${label} listing has no reviews yet (explicit zero)`, {
            competitorId: input.competitorId,
          });
          return { ok: true, verbatimsInserted: 0, empty: true };
        }
        logger.warn(`${label} snapshot has no reviews`);
        return { ok: false, reason: "no_reviews" };
      }
      text = summary.text;
      structured = { averageScore: summary.averageScore, reviewCount: summary.reviewCount };
    } else {
      text = htmlToText(html);
      // R7 (b): G2, Capterra, TrustRadius and Gartner carry no identifier to compare,
      // so the brand the page names is the only anchor left. Another product's page
      // parses perfectly and reads as a valid rating, so it is caught here — before
      // the AI is paid to summarize a competitor we don't monitor.
      const brandRefusal = competitor
        ? checkBrandPresence(text, { name: competitor.name, url: competitor.url })
        : null;
      if (brandRefusal) {
        return refuseCapture({
          snapshotId: input.snapshotId,
          competitorId: input.competitorId,
          source: input.source,
          refusal: brandRefusal,
        });
      }
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
      // The structured score never depended on the model, so a parse failure /
      // rate limit must not cost us the rating point too — it is the whole tab for
      // a competitor whose verbatims we can't cluster.
      if (structured?.averageScore != null) {
        const refusal = await persistAggregateOnly({
          competitorId: input.competitorId,
          source: input.source,
          score: structured.averageScore,
          reviewCount: structured.reviewCount,
        });
        if (refusal) {
          return refuseCapture({
            snapshotId: input.snapshotId,
            competitorId: input.competitorId,
            source: input.source,
            refusal,
          });
        }
      }
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

    // Prior point before inserting the fresh one → the summary can note the trend,
    // and R7 has something to compare against.
    const previous = await getPreviousReviewPoint(input.competitorId, input.source);
    const previousScore = previous?.score ?? null;

    // R7: the last gate before anything is written. A page that parsed but yielded no
    // score, no count and no verbatim is not a reviews page whatever it looked like;
    // a rating or a total that collapsed past half is better explained by a capture
    // of something else than by the competitor's week. Either refuses the WHOLE run —
    // no verbatims, no score point, not even the summary call — so the previous point
    // stays the served one instead of being overwritten by a wrong reading.
    const writeRefusal =
      checkReviewsStructure({
        score: extracted.average_score,
        reviewCount: extracted.review_count,
        verbatims: verbatims.length,
      }) ??
      (extracted.average_score != null
        ? checkScoreRegression(previous, {
            score: extracted.average_score,
            reviewCount: extracted.review_count,
          })
        : null);
    if (writeRefusal) {
      return refuseCapture({
        snapshotId: input.snapshotId,
        competitorId: input.competitorId,
        source: input.source,
        refusal: writeRefusal,
      });
    }

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
          await detectReviewThemeShifts.enqueue(
            { competitorId: input.competitorId },
            { singletonKey: `rts-${input.competitorId}-${input.snapshotId}` },
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
}
