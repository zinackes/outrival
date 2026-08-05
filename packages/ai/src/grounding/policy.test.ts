import { describe, expect, test } from "bun:test";
import { groundingPolicyFor } from "./grounded-call";

// Véracité Intelligence v2 P3 — which check each task gets, pinned.
//
// The audit's nuance is the load-bearing one: re-enabling the citation envelope on
// the user-facing generations is what BROKE them (a free reasoning model malforms the
// per-assertion JSON → parse miss → null → an empty profile reported as a success).
// So the four tasks below must get the deterministic post-hoc check and NOT the
// envelope, and the already-grounded tasks must keep the envelope and stay out of the
// post-hoc set.
describe("grounding policy", () => {
  test("the four user-facing generations get the deterministic check, never the envelope", () => {
    for (const task of [
      "generate_signal",
      "narrate_change",
      "summarize_competitor",
      "extract_features",
    ]) {
      const policy = groundingPolicyFor(task);
      expect(policy.postHoc).toBe(true);
      expect(policy.grounding).toBe(false);
    }
  });

  test("the already-grounded tasks are untouched by P3", () => {
    for (const task of ["generate_battle_card", "generate_digest"]) {
      expect(groundingPolicyFor(task).postHoc).toBe(false);
    }
    // An unlisted task keeps the safe default: full grounding, no post-hoc.
    expect(groundingPolicyFor("some_new_task")).toEqual({
      grounding: true,
      confidence: true,
      postHoc: false,
    });
  });

  test("generate_signal keeps its confidence channel (the self-check trigger reads it)", () => {
    expect(groundingPolicyFor("generate_signal").confidence).toBe(true);
  });
});
