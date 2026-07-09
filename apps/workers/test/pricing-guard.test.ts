import { describe, expect, test } from "bun:test";
import { isSuspectedPricingCollapse } from "../src/lib/pricing-guard";

// R4 regression: a mis-parse that collapses a healthy multi-tier page to a single
// plan used to insert and shadow the real pricing everywhere (append-only, newest
// batch wins). Block that overwrite — but only when the page still visibly carries
// several prices, so a genuine simplification is never suppressed.

describe("isSuspectedPricingCollapse — R4 anti-overwrite guard", () => {
  test("collapse while the page still shows ≥3 prices → suspected mis-parse", () => {
    expect(isSuspectedPricingCollapse({ pricedBefore: 4, pricedNow: 1, visiblePrices: 4 })).toBe(true);
    expect(isSuspectedPricingCollapse({ pricedBefore: 3, pricedNow: 0, visiblePrices: 3 })).toBe(true);
  });

  test("collapse but the page really shows ≤1 price → genuine simplification, allow", () => {
    expect(isSuspectedPricingCollapse({ pricedBefore: 5, pricedNow: 1, visiblePrices: 1 })).toBe(false);
    expect(isSuspectedPricingCollapse({ pricedBefore: 5, pricedNow: 1, visiblePrices: 2 })).toBe(false);
  });

  test("prior had <3 priced tiers → not guarded (nothing healthy to protect)", () => {
    expect(isSuspectedPricingCollapse({ pricedBefore: 2, pricedNow: 0, visiblePrices: 5 })).toBe(false);
  });

  test("new batch still has ≥2 priced tiers → not a collapse", () => {
    expect(isSuspectedPricingCollapse({ pricedBefore: 5, pricedNow: 2, visiblePrices: 5 })).toBe(false);
  });
});
