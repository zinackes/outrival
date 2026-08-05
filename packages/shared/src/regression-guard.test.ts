import { describe, test, expect } from "bun:test";
import { protectRegression, keepRatio } from "./regression-guard";

describe("protectRegression", () => {
  test("protects when a substantial prior count collapses below the keep floor", () => {
    expect(protectRegression({ prevCount: 5, nextCount: 1, minPrev: 3, minKeep: 2 })).toBe(true);
    expect(protectRegression({ prevCount: 3, nextCount: 0, minPrev: 3, minKeep: 2 })).toBe(true);
  });

  test("lets a plausible shrink through", () => {
    expect(protectRegression({ prevCount: 5, nextCount: 2, minPrev: 3, minKeep: 2 })).toBe(false);
    expect(protectRegression({ prevCount: 6, nextCount: 4, minPrev: 3, minKeep: 2 })).toBe(false);
  });

  test("a thin prior state is never protected — a real removal must be able to land", () => {
    expect(protectRegression({ prevCount: 2, nextCount: 0, minPrev: 3, minKeep: 2 })).toBe(false);
    expect(protectRegression({ prevCount: 1, nextCount: 0, minPrev: 3, minKeep: 2 })).toBe(false);
  });

  test("growth is never a regression", () => {
    expect(protectRegression({ prevCount: 5, nextCount: 9, minPrev: 3, minKeep: 2 })).toBe(false);
  });

  test("keepRatio expresses the floor as a fraction of the prior count", () => {
    expect(keepRatio(10, 0.3)).toBeCloseTo(3, 5);
    // 5 rows, 30% floor → anything under 1.5 rows (i.e. 0 or 1) is protected.
    expect(
      protectRegression({ prevCount: 5, nextCount: 1, minPrev: 5, minKeep: keepRatio(5, 0.3) }),
    ).toBe(true);
    expect(
      protectRegression({ prevCount: 5, nextCount: 2, minPrev: 5, minKeep: keepRatio(5, 0.3) }),
    ).toBe(false);
  });
});
