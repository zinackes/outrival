import { describe, expect, it } from "bun:test";
import {
  cheapestCostAtVolume,
  comparableMeters,
  type MeasuredCost,
  type MeteredRow,
} from "./pricing-model";
import type { TierBandRow } from "./price-tier-diff";

const usageRow: MeteredRow = {
  plan_name: "Pro",
  price: 0.002,
  currency: "USD",
  billing_period: "usage",
  unit: "API request",
  rate_structure: "standard",
};

const measured = (qty: number, cost: number): MeasuredCost => ({
  planName: "Usage calculator",
  meterUnit: "request",
  referenceQty: qty,
  effectiveMonthlyCost: cost,
  currency: "USD",
  measuredAt: "2026-07-30T10:00:00.000Z",
  hasEvidence: true,
});

describe("cheapestCostAtVolume — measured vs computed", () => {
  const tiers: TierBandRow[] = [];

  it("computes from the published rate when nothing was measured", () => {
    const out = cheapestCostAtVolume([usageRow], tiers, "request", 100_000);
    expect(out?.cost).toBe(200);
    expect(out?.method).toBe("computed_from_tiers");
    expect(out?.measuredAt).toBeNull();
  });

  it("prefers a MEASURED point at the same (unit, qty), even when it costs more", () => {
    const out = cheapestCostAtVolume([usageRow], tiers, "request", 100_000, [
      measured(100_000, 320),
    ]);
    // Cheapest-wins picks between PUBLISHED plans; it is not a tie-break between
    // two kinds of evidence. Their own calculator answered 320.
    expect(out?.cost).toBe(320);
    expect(out?.method).toBe("calculator_probe");
    expect(out?.measuredAt).toBe("2026-07-30T10:00:00.000Z");
    expect(out?.hasEvidence).toBe(true);
  });

  it("falls back to the computed figure at a volume that was NOT measured", () => {
    const out = cheapestCostAtVolume([usageRow], tiers, "request", 10_000, [
      measured(100_000, 320),
    ]);
    expect(out?.cost).toBe(20);
    expect(out?.method).toBe("computed_from_tiers");
  });

  it("answers from a measurement alone when the page publishes no rate at all", () => {
    const out = cheapestCostAtVolume([], [], "request", 100_000, [measured(100_000, 320)]);
    expect(out?.cost).toBe(320);
    expect(out?.planName).toBe("Usage calculator");
  });
});

describe("comparableMeters", () => {
  it("unions the published meters with the measured ones", () => {
    expect(comparableMeters([usageRow], [measured(1_000, 10)])).toEqual(["request"]);
  });

  it("surfaces a meter we only ever measured — the calculator-only case", () => {
    expect(comparableMeters([], [measured(1_000, 10)])).toEqual(["request"]);
  });

  it("is empty for a subscription-only competitor", () => {
    const flat: MeteredRow = {
      plan_name: "Pro",
      price: 49,
      currency: "USD",
      billing_period: "monthly",
    };
    expect(comparableMeters([flat], [])).toEqual([]);
  });
});
