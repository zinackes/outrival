// Auto-adjusted org relevance threshold (patch-26 layer 1). Extracted from the
// recalculation job so the gate + clamp — the guardrails that stop a runaway
// threshold from silently filtering out real signals — are unit-tested.

export interface RelevanceFeedbackStats {
  /** relevance scores of signals the org marked "useful". */
  useful: number[];
  /** relevance scores of signals the org marked "not_useful". */
  notUseful: number[];
  /** total scored feedbacks for the org. */
  total: number;
}

/** Minimum feedbacks required on EACH side before a two-sided midpoint is trusted. */
const MIN_PER_SIDE = 3;
const FLOOR = 0.2;
const CEILING = 0.8;

function average(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * The midpoint between the average relevance of "useful" and "not_useful" feedback,
 * clamped to [0.2, 0.8]. Returns null when the sample is too thin or one-sided
 * (< minFeedbacks total, or < 3 on either side) — in which case the org keeps its
 * current threshold rather than drifting off unreliable data.
 */
export function computeRelevanceThreshold(
  stats: RelevanceFeedbackStats,
  minFeedbacks: number,
): number | null {
  if (
    stats.total < minFeedbacks ||
    stats.useful.length < MIN_PER_SIDE ||
    stats.notUseful.length < MIN_PER_SIDE
  ) {
    return null;
  }
  const midpoint = (average(stats.useful) + average(stats.notUseful)) / 2;
  return Math.max(FLOOR, Math.min(CEILING, midpoint));
}
