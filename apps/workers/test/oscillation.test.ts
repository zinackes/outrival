import { describe, expect, it } from "bun:test";
import { buildDeltaProof } from "@outrival/shared";
import {
  findOscillation,
  foldOscillation,
  MAX_FOLDED_CHANGE_IDS,
  OSCILLATION_WINDOW_DAYS,
  type PriorSignalDelta,
} from "../src/lib/oscillation";

const NOW = new Date("2026-08-13T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

// The JFrog shape: a page whose plan count reads 5, then 6, then 5 again.
const FIVE_TO_SIX = "- Compare our 5 subscription plans side by side\n+ Compare our 6 subscription plans side by side";
const SIX_TO_FIVE = "- Compare our 6 subscription plans side by side\n+ Compare our 5 subscription plans side by side";

function prior(over: Partial<PriorSignalDelta> = {}): PriorSignalDelta {
  return {
    signalId: "sig-1",
    changeId: "chg-1",
    detectedAt: daysAgo(2),
    diffText: FIVE_TO_SIX,
    humanChangeBefore: "5 plans",
    humanChangeAfter: "6 plans",
    oscillation: null,
    ...over,
  };
}

describe("findOscillation", () => {
  it("folds a delta into the signal whose delta it exactly reverses", () => {
    const proof = buildDeltaProof({ diffText: SIX_TO_FIVE });
    expect(findOscillation(proof, [prior()], NOW)?.signalId).toBe("sig-1");
  });

  it("ignores a prior older than the fold window", () => {
    const proof = buildDeltaProof({ diffText: SIX_TO_FIVE });
    const old = prior({ detectedAt: daysAgo(OSCILLATION_WINDOW_DAYS + 1) });
    expect(findOscillation(proof, [old], NOW)).toBeNull();
  });

  it("does not fold a repeat of the SAME delta — that is the page changing twice", () => {
    const proof = buildDeltaProof({ diffText: FIVE_TO_SIX });
    expect(findOscillation(proof, [prior()], NOW)).toBeNull();
  });

  it("does not fold an unrelated delta on the same page", () => {
    const proof = buildDeltaProof({
      diffText: "- Enterprise plan starts at $499/mo\n+ Enterprise plan starts at $599/mo",
    });
    expect(findOscillation(proof, [prior()], NOW)).toBeNull();
  });

  it("never folds when the incoming change carries no distinctive excerpt", () => {
    // Two empty proofs are each other's inverse by construction — the guard is what
    // stops every evidence-free change collapsing into the last one.
    const proof = buildDeltaProof({ diffText: "- 6\n+ 5" });
    const noEvidence = prior({ diffText: "- 5\n+ 6", humanChangeBefore: null, humanChangeAfter: null });
    expect(findOscillation(proof, [noEvidence], NOW)).toBeNull();
  });

  it("picks the most recent inverse when the page has flipped several times", () => {
    const proof = buildDeltaProof({ diffText: SIX_TO_FIVE });
    const priors = [
      prior({ signalId: "recent", changeId: "chg-3", detectedAt: daysAgo(1) }),
      prior({ signalId: "older", changeId: "chg-1", detectedAt: daysAgo(9) }),
    ];
    expect(findOscillation(proof, priors, NOW)?.signalId).toBe("recent");
  });

  it("matches on the typed human_change pair when the diff has no +/- sides", () => {
    const proof = buildDeltaProof({
      diffText: "The pricing page moved back to its previous tier count.",
      humanChangeBefore: "6 subscription plans",
      humanChangeAfter: "5 subscription plans",
    });
    const deterministic = prior({
      diffText: "The pricing page gained a tier.",
      humanChangeBefore: "5 subscription plans",
      humanChangeAfter: "6 subscription plans",
    });
    expect(findOscillation(proof, [deterministic], NOW)?.signalId).toBe("sig-1");
  });
});

describe("foldOscillation", () => {
  it("counts the signal itself as the first observation", () => {
    const rec = foldOscillation(prior(), "chg-2", NOW);
    expect(rec).toEqual({
      observations: 2,
      variantA: "5 plans",
      variantB: "6 plans",
      changeIds: ["chg-2"],
      lastObservedAt: NOW.toISOString(),
    });
  });

  it("falls back to the delta excerpts when there is no human_change pair", () => {
    const rec = foldOscillation(
      prior({ humanChangeBefore: null, humanChangeAfter: null }),
      "chg-2",
      NOW,
    );
    expect(rec?.variantA).toContain("5 subscription plans");
    expect(rec?.variantB).toContain("6 subscription plans");
  });

  it("keeps the original variants across later flips and advances the count", () => {
    const first = foldOscillation(prior(), "chg-2", NOW)!;
    const second = foldOscillation(prior({ oscillation: first }), "chg-3", NOW)!;
    expect(second.observations).toBe(3);
    expect(second.variantA).toBe("5 plans");
    expect(second.changeIds).toEqual(["chg-2", "chg-3"]);
  });

  it("is idempotent: a retried job cannot inflate the count", () => {
    const first = foldOscillation(prior(), "chg-2", NOW)!;
    expect(foldOscillation(prior({ oscillation: first }), "chg-2", NOW)).toBeNull();
  });

  it("caps the stored change ids without capping the counter", () => {
    let rec = foldOscillation(prior(), "chg-2", NOW)!;
    for (let i = 3; i < MAX_FOLDED_CHANGE_IDS + 5; i++) {
      rec = foldOscillation(prior({ oscillation: rec }), `chg-${i}`, NOW)!;
    }
    expect(rec.changeIds.length).toBe(MAX_FOLDED_CHANGE_IDS);
    expect(rec.observations).toBe(MAX_FOLDED_CHANGE_IDS + 4);
  });

  it("returns null when neither the human pair nor the excerpts name the variants", () => {
    const bare = prior({ diffText: "- 6\n+ 5", humanChangeBefore: null, humanChangeAfter: null });
    expect(foldOscillation(bare, "chg-2", NOW)).toBeNull();
  });
});
