import { describe, expect, test } from "bun:test";
import { assessCompleteness } from "../src/lib/completeness";

// R1: a degraded-but-non-blocked capture must be graded `partial` (so the pipeline
// skips diffing it) without false-flagging healthy captures, new monitors, or
// size-variable append sources.

const base = {
  priorSizes: [1000, 1000, 1000],
  homepageIncomplete: false,
  ratioEligible: true,
  minRatio: 0.5,
  minPriors: 3,
};

describe("assessCompleteness — R1 snapshot completeness", () => {
  test("healthy content vs median → complete", () => {
    expect(assessCompleteness({ ...base, contentLength: 900 }).complete).toBe(true);
  });

  test("content far below median on a size-stable source → partial", () => {
    const v = assessCompleteness({ ...base, contentLength: 300 });
    expect(v.complete).toBe(false);
    expect(v.reason).toBe("below_median_band");
  });

  test("homepage incomplete render → partial regardless of size", () => {
    const v = assessCompleteness({ ...base, contentLength: 5000, homepageIncomplete: true });
    expect(v.complete).toBe(false);
    expect(v.reason).toBe("incomplete_render");
  });

  test("append-y source (not ratio-eligible) is never size-partial", () => {
    expect(
      assessCompleteness({ ...base, contentLength: 50, ratioEligible: false }).complete,
    ).toBe(true);
  });

  test("too few priors → median not trusted, capture allowed", () => {
    expect(
      assessCompleteness({ ...base, contentLength: 50, priorSizes: [1000, 1000] }).complete,
    ).toBe(true);
  });

  test("exactly at the ratio floor → complete (strict <)", () => {
    expect(assessCompleteness({ ...base, contentLength: 500 }).complete).toBe(true);
  });
});
