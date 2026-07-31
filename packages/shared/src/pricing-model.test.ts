import { describe, expect, it, test } from "bun:test";
import {
  cheapestCostAtVolume,
  comparableMeters,
  buildCostCurve,
  costCurveVolumes,
  COST_CURVE_MAX_QTY,
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

// ---------------------------------------------------------------------------
// The cost curve (P5) — cost as a FUNCTION of volume
// ---------------------------------------------------------------------------

describe("costCurveVolumes", () => {
  test("a 1-2-5 ladder per decade, from 1 to 10M", () => {
    const v = costCurveVolumes();
    expect(v[0]).toBe(1);
    expect(v.at(-1)).toBe(COST_CURVE_MAX_QTY);
    expect(v).toContain(500);
    expect(v).toContain(200_000);
    // Strictly increasing, no duplicates.
    expect(v.every((q, i) => i === 0 || q > v[i - 1]!)).toBe(true);
  });

  test("a published band contributes its edge and the first quantity past it", () => {
    const v = costCurveVolumes([
      { fromQty: 0, toQty: 30_000, unitPrice: 0.1, flatFee: null },
      { fromQty: 30_000, toQty: null, unitPrice: 0.05, flatFee: null },
    ]);
    expect(v).toContain(30_000);
    expect(v).toContain(30_001);
  });
});

describe("buildCostCurve", () => {
  const usageRow = (extra: Partial<MeteredRow> = {}): MeteredRow => ({
    plan_name: "Scale",
    price: 0.1,
    currency: "USD",
    billing_period: "usage",
    unit: "request",
    ...extra,
  });
  const band = (from: number, to: number | null, price: number): TierBandRow => ({
    plan_name: "Scale",
    unit: "request",
    from_qty: from,
    to_qty: to,
    unit_price: price,
    flat_fee: null,
  });

  test("a graduated ladder produces a monotonically rising curve", () => {
    const curve = buildCostCurve(
      [usageRow({ rate_structure: "graduated" })],
      [band(0, 10_000, 0.1), band(10_000, 100_000, 0.05), band(100_000, null, 0.02)],
      "request",
    );
    expect(curve).not.toBeNull();
    const costs = curve!.points.map((p) => p.cost);
    expect(costs.every((c, i) => i === 0 || c >= costs[i - 1]!)).toBe(true);
    expect(curve!.currency).toBe("USD");
  });

  test("a volume ladder keeps its cliff: one more unit costs LESS in total", () => {
    // Not a bug and not a smoothing target. Under `volume` the reached band's rate
    // applies to every unit, so crossing a boundary re-prices the whole bill:
    // 10,000 x $0.10 = $1,000, but 10,001 x $0.05 = $500.05. A buyer sitting just
    // under a boundary is overpaying, and that is precisely what the curve is for.
    const curve = buildCostCurve(
      [usageRow({ rate_structure: "volume" })],
      [band(0, 10_000, 0.1), band(10_000, null, 0.05)],
      "request",
    );
    const at = (qty: number) => curve!.points.find((p) => p.qty === qty)?.cost;
    expect(at(10_000)).toBe(1000);
    expect(at(10_001)).toBeCloseTo(500.05, 2);
    // Sampling the boundary is what makes the cliff visible at all.
    expect(at(10_000)).toBeDefined();
    expect(at(10_001)).toBeDefined();
  });

  test("a monthly floor holds the curve flat until usage overtakes it", () => {
    const curve = buildCostCurve(
      [usageRow({ rate_structure: "standard", minimum_amount: 50 })],
      [],
      "request",
    );
    const atLowVolume = curve!.points.filter((p) => p.qty <= 100);
    expect(atLowVolume.every((p) => p.cost === 50)).toBe(true);
    expect(curve!.points.at(-1)!.cost).toBeGreaterThan(50);
  });

  test("a competitor that does not meter this unit is absent, not flat at zero", () => {
    expect(buildCostCurve([usageRow({ unit: "seat" })], [], "request")).toBeNull();
  });

  test("a percentage plan has no volume to price, so it draws no curve", () => {
    const curve = buildCostCurve(
      [usageRow({ rate_structure: "percentage", percentage_rate: 2.9 })],
      [],
      "request",
    );
    expect(curve).toBeNull();
  });
});
