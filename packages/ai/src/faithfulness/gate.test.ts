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
  delete process.env.FAITHFULNESS_GATE_TASKS;
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

  test("the gate is OPT-IN: inert until explicitly enabled", () => {
    // Shipping it enabled would put an unmeasured judge between a real critical
    // alert and its customer on the first deploy.
    expect(faithfulnessGateEnabled("digest")).toBe(false);
    process.env.FAITHFULNESS_GATE_ENABLED = "false";
    expect(faithfulnessGateEnabled("digest")).toBe(false);
    process.env.FAITHFULNESS_GATE_ENABLED = "true";
    expect(faithfulnessGateEnabled("digest")).toBe(true);
  });

  test("the legacy boolean still gates every task (back-compat)", () => {
    process.env.FAITHFULNESS_GATE_ENABLED = "true";
    for (const task of ["battle_card", "digest", "signal_insight"] as const) {
      expect(faithfulnessGateEnabled(task)).toBe(true);
    }
  });
});

describe("per-task scoping (FAITHFULNESS_GATE_TASKS)", () => {
  test("only the listed tasks are gated", () => {
    process.env.FAITHFULNESS_GATE_TASKS = "battle_card,digest";
    expect(faithfulnessGateEnabled("battle_card")).toBe(true);
    expect(faithfulnessGateEnabled("digest")).toBe(true);
    // The rollout decided by plan 017: critical/high signal insights stay
    // ungated until the false-block rate is observed on the two surfaces where a
    // withheld output is recoverable.
    expect(faithfulnessGateEnabled("signal_insight")).toBe(false);
  });

  test("PRECEDENCE: the task list wins over the legacy boolean, both ways", () => {
    // .env.example ships FAITHFULNESS_GATE_ENABLED=false everywhere, so a list
    // that could be overruled by it would be unusable without a second edit.
    process.env.FAITHFULNESS_GATE_ENABLED = "false";
    process.env.FAITHFULNESS_GATE_TASKS = "digest";
    expect(faithfulnessGateEnabled("digest")).toBe(true);

    // And the other direction: the list NARROWS an environment that had the old
    // boolean on. Unsetting the list is the kill switch, not the boolean.
    process.env.FAITHFULNESS_GATE_ENABLED = "true";
    expect(faithfulnessGateEnabled("signal_insight")).toBe(false);
  });

  test("a blank list falls back to the legacy boolean", () => {
    process.env.FAITHFULNESS_GATE_ENABLED = "true";
    process.env.FAITHFULNESS_GATE_TASKS = "   ";
    expect(faithfulnessGateEnabled("digest")).toBe(true);
  });

  test("an unrecognised value gates NOTHING, even with the boolean on", () => {
    // A typo must fail towards publishing. The opposite reading — fall back to
    // the boolean — would turn `FAITHFULNESS_GATE_TASKS=battlecard` into "gate
    // everything, critical alerts included".
    process.env.FAITHFULNESS_GATE_ENABLED = "true";
    process.env.FAITHFULNESS_GATE_TASKS = "battlecard";
    expect(faithfulnessGateEnabled("battle_card")).toBe(false);
    expect(faithfulnessGateEnabled("digest")).toBe(false);
    expect(faithfulnessGateEnabled("signal_insight")).toBe(false);
  });

  test("spacing and case in the operator's value do not change the scope", () => {
    process.env.FAITHFULNESS_GATE_TASKS = " Battle_Card , digest ";
    expect(faithfulnessGateEnabled("battle_card")).toBe(true);
    expect(faithfulnessGateEnabled("digest")).toBe(true);
  });

  test("FAIL OPEN stays intact under scoping: a gated task still publishes a skipped report", () => {
    // Enabling a task changes WHETHER the chain runs, never what a skipped
    // verdict means. Re-pinned here because the scoping flag is the new thing
    // that could have coupled the two.
    process.env.FAITHFULNESS_GATE_TASKS = "battle_card,digest";
    expect(faithfulnessGateEnabled("digest")).toBe(true);
    expect(
      decideGate({ verdict: "skipped", ratio: 0, unfaithfulClaims: [unfaithful] }, 0.9).blocked,
    ).toBe(false);
  });
});
