// Snapshot completeness verdict (extracted from scrape-monitor.job.ts so it can
// be tested).
//
// R1: capture success is binary — a degraded-but-non-blocked render (a partial
// hydration, a shell that clears the anti-void floor) is stored as full "success"
// and becomes the diff baseline, fabricating phantom "everything changed" diffs
// (and, if it persists, masking the real content underneath). The cascade already
// THROWS on the worst cases (absolute collapse, below-0.3×median soft-block); this
// grades the middle band that slips through and marks it `partial`, so the pipeline
// refuses to diff a degraded capture. Bonus: the anti-void median query filters
// status="success", so a partial no longer pollutes that median.
//
// Two signals, both from data available at snapshot insert:
//  - homepage: an incomplete semantic render (no hero + ≤1 section) — a heading-less
//    or JS-failed home the structure parser can't read.
//  - size band: extracted content far below this monitor's recent median. Only for
//    size-stable sources (append-y blog/changelog/news/sitemap legitimately swing,
//    so the caller marks them ineligible) and only with enough priors to trust the
//    median (a new monitor is never flagged).

export interface CompletenessInput {
  /** Length of the extracted visible content of THIS capture. */
  contentLength: number;
  /** Recent successful `content_size` values for this monitor (may be empty). */
  priorSizes: number[];
  /** homepage only: isIncompleteRender(structure). false for every other source. */
  homepageIncomplete: boolean;
  /** false for size-variable append sources (blog/changelog/news/sitemap). */
  ratioEligible: boolean;
  /** content/median ratio below which the capture is judged degraded. */
  minRatio: number;
  /** minimum priors before the median is trusted (avoids flagging new monitors). */
  minPriors: number;
}

export type CompletenessReason = "incomplete_render" | "below_median_band" | "deny_page";

export interface CompletenessVerdict {
  complete: boolean;
  reason: CompletenessReason | null;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function assessCompleteness(input: CompletenessInput): CompletenessVerdict {
  if (input.homepageIncomplete) {
    return { complete: false, reason: "incomplete_render" };
  }
  if (input.ratioEligible && input.priorSizes.length >= input.minPriors) {
    const m = median(input.priorSizes);
    if (m > 0 && input.contentLength / m < input.minRatio) {
      return { complete: false, reason: "below_median_band" };
    }
  }
  return { complete: true, reason: null };
}
