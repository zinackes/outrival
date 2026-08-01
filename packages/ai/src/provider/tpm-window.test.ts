import { describe, expect, it } from "bun:test";
import { slidingWindowTokens, hasHeadroom } from "./tpm-window";

describe("slidingWindowTokens", () => {
  it("counts the whole previous minute at the start of the current one", () => {
    expect(slidingWindowTokens(1000, 200, 0)).toBe(1200);
  });

  it("drops the previous minute entirely once it has aged out", () => {
    expect(slidingWindowTokens(1000, 200, 60_000)).toBe(200);
  });

  it("carries the previous minute proportionally through the current one", () => {
    expect(slidingWindowTokens(1000, 0, 30_000)).toBe(500);
    expect(slidingWindowTokens(1000, 0, 45_000)).toBe(250);
  });

  it("never carries a negative share when the clock runs past the window", () => {
    expect(slidingWindowTokens(1000, 200, 90_000)).toBe(200);
  });

  it("treats missing buckets as zero rather than as debt", () => {
    expect(slidingWindowTokens(0, 0, 15_000)).toBe(0);
    expect(slidingWindowTokens(-5, -5, 15_000)).toBe(0);
  });
});

describe("hasHeadroom", () => {
  const base = { observed: 0, limit: 8000, cost: 1000, reserveFraction: 0.2, interactive: false };

  it("admits a request that fits under the background ceiling", () => {
    expect(hasHeadroom({ ...base, observed: 5000 })).toBe(true);
  });

  it("refuses a request that would cross the background ceiling", () => {
    // background ceiling = 8000 * 0.8 = 6400
    expect(hasHeadroom({ ...base, observed: 5401 })).toBe(false);
  });

  // The whole point of the reserve: the fan-out cannot eat the budget a click needs.
  it("admits an interactive request the background ceiling would have refused", () => {
    expect(hasHeadroom({ ...base, observed: 5401, interactive: true })).toBe(true);
  });

  it("still refuses an interactive request past the real ceiling", () => {
    expect(hasHeadroom({ ...base, observed: 7001, interactive: true })).toBe(false);
  });

  // An unconfigured provider must behave exactly as it did before pacing existed.
  it("never paces a provider with no configured limit", () => {
    expect(hasHeadroom({ ...base, limit: 0, observed: 999_999 })).toBe(true);
    expect(hasHeadroom({ ...base, limit: -1, observed: 999_999 })).toBe(true);
  });

  it("clamps a nonsense reserve fraction instead of inverting the ceiling", () => {
    expect(hasHeadroom({ ...base, reserveFraction: 2, observed: 0, cost: 1 })).toBe(false);
    expect(hasHeadroom({ ...base, reserveFraction: -1, observed: 7999, cost: 1 })).toBe(true);
  });

  it("admits a request landing exactly on the ceiling", () => {
    expect(hasHeadroom({ ...base, observed: 5400 })).toBe(true);
  });
});
