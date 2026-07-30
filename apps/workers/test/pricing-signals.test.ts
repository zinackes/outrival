import { describe, expect, test } from "bun:test";
import { diffPricingBatches, type PricingBatchRow } from "@outrival/shared";
import { planPricingSignal } from "../src/lib/pricing-signals";
import { applySeverityGuard } from "../src/lib/severity-guard";

// Pricing Intelligence P1 — the synthesized classification the deterministic
// batch diff emits, and its interaction with the severity guard (the pricing
// critical must survive: the rendered fact lines carry price tokens).

const row = (partial: Partial<PricingBatchRow> & { plan_name: string }): PricingBatchRow => ({
  price: null,
  currency: "USD",
  billing_period: "monthly",
  ...partial,
});

describe("planPricingSignal", () => {
  test("the worst change leads: severity, reason, exact before/after pair", () => {
    const changes = diffPricingBatches(
      [row({ plan_name: "Pro", price: 79 }), row({ plan_name: "Starter", price: 29 })],
      [row({ plan_name: "Pro", price: 59 }), row({ plan_name: "Starter", price: 29.5 })],
    );
    const plan = planPricingSignal(changes);
    expect(plan.classification.category).toBe("pricing");
    expect(plan.classification.severity).toBe("critical");
    expect(plan.classification.is_significant).toBe(true);
    expect(plan.classification.humanChangeBefore).toBe("Pro — $79/mo");
    expect(plan.classification.humanChangeAfter).toBe("Pro — $59/mo");
    expect(plan.classification.reason).toBe(
      "Pro: $79/mo → $59/mo (−25.3%) (+1 more pricing change)",
    );
  });

  test("the diffText names every change, one fact line each", () => {
    const changes = diffPricingBatches(
      [row({ plan_name: "Pro", price: 79 })],
      [row({ plan_name: "Pro", price: 99 }), row({ plan_name: "Scale", price: 199 })],
    );
    const plan = planPricingSignal(changes);
    expect(plan.diffText).toContain("- New plan: Scale — $199/mo");
    expect(plan.diffText).toContain("- Pro: $79/mo → $99/mo (+25.3%)");
  });

  test("a deterministic pricing critical survives the severity guard", () => {
    const changes = diffPricingBatches(
      [row({ plan_name: "Pro", price: 100 })],
      [row({ plan_name: "Pro", price: 79 })],
    );
    const plan = planPricingSignal(changes);
    const guarded = applySeverityGuard({
      severity: plan.classification.severity,
      category: plan.classification.category,
      sourceType: "pricing",
      diffText: plan.diffText,
    });
    expect(guarded.demoted).toBe(false);
    expect(guarded.severity).toBe("critical");
  });

  test("a single change carries no '+N more' suffix", () => {
    const changes = diffPricingBatches(
      [row({ plan_name: "Pro", price: 100 })],
      [row({ plan_name: "Pro", price: 101 })],
    );
    const plan = planPricingSignal(changes);
    expect(plan.classification.severity).toBe("low");
    expect(plan.classification.reason).toBe("Pro: $100/mo → $101/mo (+1%)");
  });
});
