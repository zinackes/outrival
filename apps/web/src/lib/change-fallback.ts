/**
 * What a change says when it carries no AI summary.
 *
 * The card used to offer "Classify with AI" on those rows, including the ones the
 * pipeline had already decided not to classify: a diff scored below the lexical
 * significance threshold, or a review capture whose whole list is rewritten on
 * every scrape. Running the classifier there spends a model call to be told again
 * that nothing moved, and on a review blob it has invented moves that never
 * happened. So the row names the reason instead, deterministically, and the review
 * sources print the numbers extraction already recorded, which is the only
 * readable content those rows have.
 */

export interface ReviewCapture {
  score: number;
  reviewCount: number;
  prevScore: number | null;
  prevReviewCount: number | null;
}

// Keyed by `changes.suppression_reason`. A row with no reason and no summary was
// never classified (the job is still in flight, or it failed), which is a
// different sentence from "we chose not to".
const NO_SUMMARY_REASON: Record<string, string> = {
  trivial_diff: "Too small to classify: the page moved by a timestamp, a counter or a hash.",
  rotating_list:
    "This page rewrites its whole list on every check, so we track its numbers rather than its diff.",
  cosmetic: "The wording moved, the facts did not.",
};

export function noSummaryReason(suppressionReason: string | null | undefined): string {
  return NO_SUMMARY_REASON[suppressionReason ?? ""] ?? "Not classified.";
}

/**
 * "4.7★ → 4.6★ · 1,203 reviews (+12)" — the rating and volume the extraction
 * recorded around this change, and what moved since the capture before it.
 *
 * Same vocabulary as the activity feed's captured column, so a review row reads
 * the same on both surfaces.
 */
export function reviewCaptureLine(c: ReviewCapture): string {
  const score = c.score.toFixed(1);
  // Compare what the reader sees, not the raw floats: 4.64 and 4.61 both print
  // "4.6", and "4.6★ → 4.6★" reads as a bug rather than as a steady rating.
  const prevScore = c.prevScore == null ? null : c.prevScore.toFixed(1);
  const rating =
    prevScore !== null && prevScore !== score ? `${prevScore}★ → ${score}★` : `${score}★`;

  if (c.reviewCount <= 0) return rating;
  const moved =
    c.prevReviewCount != null && c.prevReviewCount !== c.reviewCount
      ? ` (${c.reviewCount > c.prevReviewCount ? "+" : "-"}${Math.abs(
          c.reviewCount - c.prevReviewCount,
        ).toLocaleString("en-US")})`
      : "";
  return `${rating} · ${c.reviewCount.toLocaleString("en-US")} reviews${moved}`;
}
