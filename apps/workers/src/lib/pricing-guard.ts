// Pricing anti-overwrite decision (extracted from extract-pricing.job.ts so it
// can be tested).
//
// R4 guard: pricing_history is append-only and every read takes the newest batch
// (competitors.ts latestDetectedPricing), so a batch that collapses a healthy
// multi-tier page down to a single plan — a harvest band, a lone card grabbed by
// the AI floor, a promo price — silently SHADOWS the real tiers everywhere. Empty
// results are already safe (no rows inserted); a non-empty mis-parse is not.
//
// We only treat a collapse as a mis-parse when the page STILL visibly carries
// several prices (the AI-free DOM harvest independently finds ≥3), i.e. the tiers
// are there and extraction failed to capture them. A genuine pricing simplification
// (a competitor really moving to ≤1 public price) shows few prices on the page, so
// `visiblePrices` is low and the batch is allowed through — the guard never
// suppresses a real strategic move, it only blocks garbage.

export function isSuspectedPricingCollapse(args: {
  /** Priced (price>0) tiers in the prior (latest stored) batch. */
  pricedBefore: number;
  /** Priced tiers in the fresh extraction about to be inserted. */
  pricedNow: number;
  /** Priced tiers the AI-free harvest independently finds on the page. */
  visiblePrices: number;
}): boolean {
  const { pricedBefore, pricedNow, visiblePrices } = args;
  return pricedBefore >= 3 && pricedNow <= 1 && visiblePrices >= 3;
}
