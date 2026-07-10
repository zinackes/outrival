import { describe, expect, test } from "bun:test";
import {
  computeBlocks,
  evidenceBlock,
  evidenceSourceText,
  type BattleCardInput,
} from "./battle-card";

// The evidence must OMIT absent dimensions instead of rendering placeholders:
// "Not captured." / "n/a" / "unknown" lines used to reach the model, which
// turned OUR data gaps into competitor weaknesses ("customer reviews and
// ratings are not captured") that survived the revise pass (2026-07-10 audit).

function minimalInput(): BattleCardInput {
  return {
    myProduct: { category: "Game hosting", valueProp: "Stable low-latency servers" },
    competitorName: "Iceline Hosting",
    competitorSummary: null,
    reviewPraises: [],
    reviewComplaints: [],
    recentSignals: [],
  };
}

describe("battle card evidence", () => {
  test("absent dimensions render NO placeholder text", () => {
    const input = minimalInput();
    const b = computeBlocks(input);
    for (const text of [evidenceBlock(input, b), evidenceSourceText(input, b)]) {
      expect(text.toLowerCase()).not.toContain("not captured");
      expect(text.toLowerCase()).not.toContain("n/a");
      expect(text.toLowerCase()).not.toContain("unknown");
      expect(text).not.toContain("<reviews>");
      expect(text).not.toContain("<recent_signals>");
      // What we DO know still renders.
      expect(text).toContain("Game hosting");
      expect(text).toContain("Iceline Hosting");
    }
  });

  test("captured dimensions still render as facts", () => {
    const input: BattleCardInput = {
      ...minimalInput(),
      competitorSummary: "A game-server host.",
      competitorTrial: { hasTrial: false, days: null, requiresCreditCard: null },
      competitorPricingTiers: [
        { planName: "Starter", price: 9.99, currency: "GBP", billingPeriod: "monthly" },
      ],
      reviewPraises: ["Great uptime"],
      recentSignals: [{ category: "pricing", severity: "high", insight: "Raised prices" }],
    };
    const b = computeBlocks(input);
    const block = evidenceBlock(input, b);
    expect(block).toContain("Free trial: none offered.");
    expect(block).toContain("Starter: 9.99 GBP / monthly");
    expect(block).toContain("Great uptime");
    expect(block).toContain("Raised prices");
    expect(block).toContain("A game-server host.");
    // "none offered" is a real detection result, not a gap — but nothing else
    // in this input may leak placeholder wording.
    expect(block.toLowerCase()).not.toContain("not captured");
  });
});
