import { describe, expect, test } from "bun:test";
import {
  buildRevisePrompt,
  computeBlocks,
  evidenceBlock,
  evidenceSourceText,
  type BattleCardContent,
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

// The repair path: a card the publication gate refused is not discarded whole. The
// refused sentences are named to this pass, and the caller re-verifies its output —
// so the prompt has to carry them verbatim, and carry NOTHING extra when there are
// none (the ordinary revise pass must keep behaving exactly as it did).
describe("revise prompt", () => {
  const draft: BattleCardContent = {
    their_strengths: ["30-day trial"],
    our_strengths: ["Flat pricing"],
    their_weaknesses: ["Card required up front"],
    common_objections: [{ objection: "They're cheaper", response: "Only on annual" }],
    when_we_win: ["Teams under 10"],
    when_we_lose: ["Enterprise procurement"],
  };

  test("no refused claims: no repair section at all", () => {
    const p = buildRevisePrompt(minimalInput(), draft);
    expect(p).not.toContain("<refused_claims>");
    expect(p).toContain("<draft>");
  });

  test("refused claims are listed verbatim and ordered to be deleted", () => {
    const claims = [
      "Iceline Hosting has no free trial without payment information.",
      "Iceline Hosting has no SOC 2 certification.",
    ];
    const p = buildRevisePrompt(minimalInput(), draft, claims);
    expect(p).toContain("<refused_claims>");
    for (const c of claims) expect(p).toContain(c);
    expect(p).toContain("DELETE every entry that states any of them");
    // The draft still travels: the pass prunes it, it does not rewrite from scratch.
    expect(p).toContain("30-day trial");
  });

  test("an empty list is not a repair", () => {
    expect(buildRevisePrompt(minimalInput(), draft, [])).not.toContain("<refused_claims>");
  });
});
