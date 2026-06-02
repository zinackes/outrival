/**
 * Anti-void guard based on the HISTORICAL MEDIAN — patch-17. Complements the
 * absolute emptiness guard (isContentCollapsed, ~near-zero chars): this one
 * catches a soft-block / failed render that returns a few hundred chars of shell —
 * well below what this monitor normally serves — without masking a GENUINE content
 * reduction. Two safeguards make it conservative:
 *   1. it only ever fires when the content is absolutely small (block-like), so a
 *      large page that merely shrank is never flagged;
 *   2. once the smaller size persists (the last snapshot was already small) it's
 *      accepted as the new normal.
 *
 * PURE: sizes in, decision out. The worker reads the prior sizes and decides what
 * to do (retry). Exposed as the `@outrival/scrapers/anti-void` subpath.
 */

export interface AntiVoidDecision {
  isVoid: boolean;
  reason?: string;
}

export interface AntiVoidOptions {
  /** current/median below this ⇒ a void candidate. Default 0.3. */
  ratioThreshold?: number;
  /** only ever a candidate when content is also this small (chars). Default 600. */
  absoluteCeiling?: number;
}

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

/**
 * @param currentSize char length of the freshly extracted content
 * @param priorSizes  prior snapshots' content sizes, MOST RECENT FIRST (priorSizes[0]
 *                    is the previous snapshot). Up to ~5.
 */
export function checkAntiVoid(
  currentSize: number,
  priorSizes: number[],
  opts: AntiVoidOptions = {},
): AntiVoidDecision {
  const ratioThreshold = opts.ratioThreshold ?? 0.3;
  const absoluteCeiling = opts.absoluteCeiling ?? 600;

  // A large page that shrank is a genuine reduction, never a block — don't mask it.
  if (currentSize >= absoluteCeiling) return { isVoid: false };

  if (priorSizes.length < 2) {
    // Not enough history → simple last-vs-current fallback (the pre-median behavior).
    const last = priorSizes[0] ?? 0;
    if (last > 1000 && currentSize < 200) {
      return { isVoid: true, reason: "much_smaller_than_last" };
    }
    return { isVoid: false };
  }

  const median = computeMedian(priorSizes);
  if (median <= 0) return { isVoid: false };
  const ratio = currentSize / median;
  if (ratio < ratioThreshold) {
    // The previous snapshot was already this small → it's the new normal, not a block.
    const last = priorSizes[0] ?? 0;
    if (last / median < ratioThreshold * 1.5) {
      return { isVoid: false, reason: "stable_smaller_content" };
    }
    return { isVoid: true, reason: "below_historical_median" };
  }
  return { isVoid: false };
}
