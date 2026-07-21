import { afterEach, describe, expect, test } from "bun:test";
import { decideGate, faithfulnessMinRatio, faithfulnessGateEnabled } from "./gate";
import type { ClaimVerdict } from "./types";

// Blocking publication is the most consequential thing this feature does — a wrong
// block silences a real alert. These tests pin both directions: an unfaithful claim
// always blocks, and an infrastructure failure NEVER does.

const unfaithful: ClaimVerdict = {
  claim: { text: "Acme has no SOC 2 certification.", citedQuote: "" },
  status: "unfaithful",
  reason: "the source says nothing about certifications",
};

afterEach(() => {
  delete process.env.FAITHFULNESS_MIN_RATIO;
  delete process.env.FAITHFULNESS_GATE_ENABLED;
});

describe("decideGate", () => {
  test("a fully supported output publishes", () => {
    expect(decideGate({ verdict: "pass", ratio: 1, unfaithfulClaims: [] }, 0.9).blocked).toBe(false);
  });

  test("one unfaithful claim blocks, whatever the ratio", () => {
    const d = decideGate({ verdict: "pass", ratio: 0.99, unfaithfulClaims: [unfaithful] }, 0.9);
    expect(d.blocked).toBe(true);
    expect(d.reason).toContain("SOC 2");
  });

  test("a ratio under the threshold blocks", () => {
    const d = decideGate({ verdict: "pass", ratio: 0.5, unfaithfulClaims: [] }, 0.9);
    expect(d.blocked).toBe(true);
    expect(d.reason).toContain("0.50");
  });

  test("a ratio exactly at the threshold publishes", () => {
    expect(decideGate({ verdict: "pass", ratio: 0.9, unfaithfulClaims: [] }, 0.9).blocked).toBe(false);
  });

  test("FAIL OPEN: a skipped verification never blocks", () => {
    // Extraction parse miss, rate limit, open breaker. An AI outage must not
    // silence every battle card, digest and alert at once.
    expect(
      decideGate({ verdict: "skipped", ratio: 0, unfaithfulClaims: [unfaithful] }, 0.9).blocked,
    ).toBe(false);
  });
});

describe("configuration", () => {
  test("the default minimum ratio is 0.9", () => {
    expect(faithfulnessMinRatio()).toBe(0.9);
  });

  test("FAITHFULNESS_MIN_RATIO overrides it", () => {
    process.env.FAITHFULNESS_MIN_RATIO = "0.75";
    expect(faithfulnessMinRatio()).toBe(0.75);
  });

  test("a nonsense threshold falls back to the default", () => {
    process.env.FAITHFULNESS_MIN_RATIO = "not-a-number";
    expect(faithfulnessMinRatio()).toBe(0.9);
  });

  test("the gate is on by default and only 'false' disables it", () => {
    expect(faithfulnessGateEnabled()).toBe(true);
    process.env.FAITHFULNESS_GATE_ENABLED = "false";
    expect(faithfulnessGateEnabled()).toBe(false);
  });
});
