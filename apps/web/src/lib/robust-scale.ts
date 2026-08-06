/**
 * How far an axis stretches before one reading owns it.
 *
 * Every chart that plots money across a field hits the same wall: one $2,400
 * enterprise tier against six $10 seat prices flattens the other six into a
 * bundle two pixels tall, and the question the page exists to answer ("who is
 * dearer, who moved") stops being legible. Measured on the Trends slopegraph's
 * 176px plot: at 5× the median the end dots are 1.7px apart, at 50× they are
 * 0.14px apart and a real +22.7% move draws 0.9px of travel.
 *
 * The answer everywhere is the same one the compare price lens already used —
 * scale to the readable range, draw the outliers clipped and SAY so — so the
 * rule that decides what an outlier is lives here once rather than being
 * re-picked per chart.
 */

/** Median, or null on an empty set. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  // Even count → the mean of the two middle values.
  return s.length % 2 === 0 ? ((s[mid - 1] as number) + (s[mid] as number)) / 2 : (s[mid] as number);
}

/**
 * How many times the median a reading may reach before it counts as an outlier
 * that owns the axis. Four is where the flattening becomes unreadable rather
 * than merely tight (see the pixel table above).
 */
export const OUTLIER_FACTOR = 4;

/**
 * The largest value worth scaling to: the raw maximum, unless it dwarfs the median,
 * in which case the highest NON-outlier value. Values past it are drawn clipped, and
 * their true number is still read in the row's own label.
 */
export function robustCeiling(tops: number[], factor = OUTLIER_FACTOR): number {
  if (tops.length === 0) return 0;
  const raw = Math.max(...tops);
  const med = median(tops) ?? raw;
  if (med <= 0 || raw <= med * factor) return raw;
  const inliers = tops.filter((t) => t <= med * factor);
  return inliers.length ? Math.max(...inliers) : raw;
}

export interface RobustExtent {
  /** Bottom of the axis in force. */
  min: number;
  /** Top of the axis in force. */
  max: number;
  /** True extremes, for the "show me the whole spread" way back. */
  fullMin: number;
  fullMax: number;
  /** How many values fall outside [min, max] and are drawn clipped. */
  clippedCount: number;
}

/**
 * Both ends of a readable axis over `values`.
 *
 * Two-ended, unlike `robustCeiling`: a percent-change chart is crushed from below
 * by a competitor that went 1 → 30 open roles (+2900%) exactly as a price ladder is
 * crushed from above by one enterprise plan, and both charts are drawn from this.
 *
 * The yardstick is the median of the magnitudes, so it works on a set straddling
 * zero. A field with no outlier comes back as its own min and max and nothing is
 * clipped — the common case pays nothing for this.
 */
export function robustExtent(values: number[], factor = OUTLIER_FACTOR): RobustExtent | null {
  if (values.length === 0) return null;
  const fullMin = Math.min(...values);
  const fullMax = Math.max(...values);
  const scale = median(values.map(Math.abs)) ?? 0;
  const limit = scale * factor;
  const inliers = scale > 0 ? values.filter((v) => Math.abs(v) <= limit) : [];
  // Every reading is an outlier by its own yardstick (an all-zero field, or two
  // values a decade apart with no middle) — there is no readable subset to prefer,
  // so the axis holds everything and nothing is marked.
  if (inliers.length === 0) {
    return { min: fullMin, max: fullMax, fullMin, fullMax, clippedCount: 0 };
  }
  const min = Math.min(...inliers);
  const max = Math.max(...inliers);
  return {
    min,
    max,
    fullMin,
    fullMax,
    clippedCount: values.filter((v) => v < min || v > max).length,
  };
}
