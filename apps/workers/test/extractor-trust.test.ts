import { describe, expect, test } from "bun:test";
import { shouldTrustCachedExtractor } from "../src/lib/extractor-trust";

// R8: a cached parser used to be trusted forever as long as its replay looked
// "plausible", so a drifted selector producing wrong-but-plausible data was never
// healed. A spec must now expire and be regenerated against the current DOM.

const DAY = 24 * 60 * 60 * 1000;
const now = 1_000 * DAY;
const base = {
  now,
  revalidateMs: 14 * DAY,
  maxFailures: 5,
  consecutiveFailures: 0,
};

describe("shouldTrustCachedExtractor — R8 cached-parser expiry", () => {
  test("a fresh, healthy spec is trusted", () => {
    expect(
      shouldTrustCachedExtractor({ ...base, lastValidatedAt: new Date(now - 1 * DAY) }),
    ).toBe(true);
  });

  test("a spec older than the revalidation window is distrusted", () => {
    expect(
      shouldTrustCachedExtractor({ ...base, lastValidatedAt: new Date(now - 15 * DAY) }),
    ).toBe(false);
  });

  test("exactly at the window boundary is distrusted (strict <)", () => {
    expect(
      shouldTrustCachedExtractor({ ...base, lastValidatedAt: new Date(now - 14 * DAY) }),
    ).toBe(false);
  });

  test("a never-validated spec is distrusted", () => {
    expect(shouldTrustCachedExtractor({ ...base, lastValidatedAt: null })).toBe(false);
  });

  test("too many consecutive replay failures distrust even a fresh spec", () => {
    expect(
      shouldTrustCachedExtractor({
        ...base,
        consecutiveFailures: 5,
        lastValidatedAt: new Date(now - 1 * DAY),
      }),
    ).toBe(false);
  });

  test("failures below the threshold do not distrust a fresh spec", () => {
    expect(
      shouldTrustCachedExtractor({
        ...base,
        consecutiveFailures: 4,
        lastValidatedAt: new Date(now - 1 * DAY),
      }),
    ).toBe(true);
  });
});
