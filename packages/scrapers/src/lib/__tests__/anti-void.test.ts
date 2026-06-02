import { test, expect, describe } from "bun:test";
import { checkAntiVoid, computeMedian } from "../anti-void";

describe("computeMedian", () => {
  test("odd and even", () => {
    expect(computeMedian([1000, 200, 800])).toBe(800);
    expect(computeMedian([1000, 1000, 200, 800])).toBe(900);
    expect(computeMedian([])).toBe(0);
  });
});

describe("checkAntiVoid", () => {
  test("collapse far below median → void", () => {
    const d = checkAntiVoid(200, [1000, 1000, 1000, 1000]);
    expect(d.isVoid).toBe(true);
    expect(d.reason).toBe("below_historical_median");
  });

  test("a stably small page is the new normal → not void", () => {
    expect(checkAntiVoid(180, [200, 200, 200]).isVoid).toBe(false);
  });

  test("a genuine reduction of a large page is NOT masked", () => {
    // 1400 is below 30% of a 5000 median, but it's not block-small → not void.
    expect(checkAntiVoid(1400, [5000, 5000, 5000]).isVoid).toBe(false);
  });

  test("not enough history → last-vs-current fallback", () => {
    expect(checkAntiVoid(100, [2000]).isVoid).toBe(true);
    expect(checkAntiVoid(100, []).isVoid).toBe(false);
  });

  test("a drop to the new normal that just happened still fires once", () => {
    // last was big (1000), current collapsed (150) → void.
    expect(checkAntiVoid(150, [1000, 1000, 1000]).isVoid).toBe(true);
  });

  test("respects a custom ratio threshold", () => {
    // 250/1000 = 0.25; with a stricter 0.2 threshold it's no longer void.
    expect(checkAntiVoid(250, [1000, 1000, 1000], { ratioThreshold: 0.2 }).isVoid).toBe(false);
  });
});
