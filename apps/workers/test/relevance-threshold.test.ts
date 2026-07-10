import { describe, expect, test } from "bun:test";
import { computeRelevanceThreshold } from "../src/lib/relevance-threshold";

// ÉTAPE 4 guardrail (2026-07 audit) — the relevance threshold is auto-adjusted from
// org feedback and then SILENTLY filters signals below it (patch-26 dispatcher). If
// the recalc ever drifts off a thin or one-sided sample, or escapes its clamp, an
// org can start dropping real signals with no error. These lock the two protections:
// the two-sided sample gate and the [0.2, 0.8] clamp.
describe("computeRelevanceThreshold", () => {
  const MIN = 10;

  test("too few feedbacks total → null (keep default, never drift on thin data)", () => {
    expect(
      computeRelevanceThreshold({ useful: [0.8, 0.8, 0.8], notUseful: [0.4, 0.4], total: 5 }, MIN),
    ).toBeNull();
  });

  test("one-sided feedback → null (needs ≥3 on BOTH sides)", () => {
    expect(
      computeRelevanceThreshold(
        { useful: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8], notUseful: [0.4, 0.4], total: 12 },
        MIN,
      ),
    ).toBeNull();
  });

  test("sufficient two-sided sample → midpoint of the two averages", () => {
    // avg(useful)=0.8, avg(notUseful)=0.4 → midpoint 0.6
    expect(
      computeRelevanceThreshold(
        { useful: [0.8, 0.8, 0.8], notUseful: [0.4, 0.4, 0.4], total: 10 },
        MIN,
      ),
    ).toBeCloseTo(0.6, 5);
  });

  test("midpoint below floor is clamped to 0.2", () => {
    expect(
      computeRelevanceThreshold(
        { useful: [0.05, 0.05, 0.05], notUseful: [0.01, 0.01, 0.01], total: 10 },
        MIN,
      ),
    ).toBe(0.2);
  });

  test("midpoint above ceiling is clamped to 0.8", () => {
    expect(
      computeRelevanceThreshold(
        { useful: [0.99, 0.99, 0.99], notUseful: [0.95, 0.95, 0.95], total: 10 },
        MIN,
      ),
    ).toBe(0.8);
  });
});
