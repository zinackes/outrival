import { protectRegression, keepRatio } from "@outrival/shared";

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

// Both guards below are usages of the shared `protectRegression` arithmetic
// (P1 / audit R4-R5 unification): "the prior state was substantial AND the fresh
// count keeps too little of it". Only the EVIDENCE differs — pricing corroborates
// with an independent harvest of the page, entitlements have no such probe — so
// only the thresholds and the corroboration live here.

/** Prior batches smaller than this are not protected: a real move is plausible. */
const PRICING_MIN_PRIOR_TIERS = 3;
/** A healthy pricing extraction of a multi-tier page keeps at least 2 priced tiers. */
const PRICING_MIN_KEPT_TIERS = 2;
/** Prices the AI-free harvest must still see for the collapse to read as a mis-parse. */
const PRICING_MIN_VISIBLE_PRICES = 3;

export function isSuspectedPricingCollapse(args: {
  /** Priced (price>0) tiers in the prior (latest stored) batch. */
  pricedBefore: number;
  /** Priced tiers in the fresh extraction about to be inserted. */
  pricedNow: number;
  /** Priced tiers the AI-free harvest independently finds on the page. */
  visiblePrices: number;
}): boolean {
  const { pricedBefore, pricedNow, visiblePrices } = args;
  return (
    protectRegression({
      prevCount: pricedBefore,
      nextCount: pricedNow,
      minPrev: PRICING_MIN_PRIOR_TIERS,
      minKeep: PRICING_MIN_KEPT_TIERS,
    }) && visiblePrices >= PRICING_MIN_VISIBLE_PRICES
  );
}

// Same philosophy for the entitlement matrix (Pricing Intelligence P2), simpler
// evidence: there is no independent "visible entitlements" probe, so a rich
// matrix (≥5 rows) that suddenly extracts to nothing — or to under 30% of
// itself — is treated as a failed extraction outright. The fresh batch is NOT
// written and NO removal/move signal is derived from it: a flaky accordion or a
// prompt miss must never read as "they un-gated everything". A real packaging
// simplification below that cliff still surfaces next scrape via the plans/
// price diff, and partial shrinkage above 30% diffs normally.
/** Matrices smaller than this are too thin for a shrink to read as a failure. */
const ENTITLEMENT_MIN_PRIOR_ROWS = 5;
/** A healthy extraction keeps at least this fraction of a known matrix. */
const ENTITLEMENT_MIN_KEPT_RATIO = 0.3;

export function isSuspectedEntitlementCollapse(args: {
  /** Entitlement rows in the prior (latest stored) batch. */
  prevCount: number;
  /** Entitlement rows in the fresh extraction. */
  nextCount: number;
}): boolean {
  const { prevCount, nextCount } = args;
  return protectRegression({
    prevCount,
    nextCount,
    minPrev: ENTITLEMENT_MIN_PRIOR_ROWS,
    minKeep: keepRatio(prevCount, ENTITLEMENT_MIN_KEPT_RATIO),
  });
}
