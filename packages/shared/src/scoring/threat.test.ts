import { describe, expect, it } from "bun:test";
import { computeThreatScore } from "./threat";

describe("computeThreatScore", () => {
  it("scores a critical signal from a fully-overlapping, fully-relevant competitor at 1", () => {
    expect(
      computeThreatScore({ severity: "critical", overlapScore: 100, relevanceScore: 1 }),
    ).toBe(1);
  });

  it("uses neutral 0.5 for a null overlap (manually-added competitor)", () => {
    // critical (1) × neutral overlap (0.5) × relevance 1 = 0.5
    expect(
      computeThreatScore({ severity: "critical", overlapScore: null, relevanceScore: 1 }),
    ).toBe(0.5);
  });

  it("uses neutral 0.5 for a null relevance (non-homepage source)", () => {
    // high (0.75) × overlap 1 × neutral relevance (0.5) = 0.375
    expect(
      computeThreatScore({ severity: "high", overlapScore: 100, relevanceScore: null }),
    ).toBeCloseTo(0.375, 5);
  });

  it("never collapses to 0 when both nullable axes are missing", () => {
    // medium (0.5) × 0.5 × 0.5 = 0.125
    const score = computeThreatScore({
      severity: "medium",
      overlapScore: null,
      relevanceScore: null,
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeCloseTo(0.125, 5);
  });

  it("ranks a frontal mover above a tangential one of equal severity", () => {
    const frontal = computeThreatScore({
      severity: "high",
      overlapScore: 90,
      relevanceScore: 0.8,
    });
    const tangential = computeThreatScore({
      severity: "high",
      overlapScore: 20,
      relevanceScore: 0.8,
    });
    expect(frontal).toBeGreaterThan(tangential);
  });

  it("clamps an out-of-range overlap score", () => {
    expect(
      computeThreatScore({ severity: "critical", overlapScore: 150, relevanceScore: 1 }),
    ).toBe(1);
  });
});
