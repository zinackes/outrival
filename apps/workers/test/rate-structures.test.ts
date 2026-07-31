import { test, expect, describe } from "bun:test";
import { prepareRateStructures } from "../src/lib/rate-structures";
import type { PricingPlan } from "@outrival/ai";

const AT = new Date("2026-07-31T09:00:00.000Z");

function prepare(plans: PricingPlan[], pageText = "") {
  return prepareRateStructures({ competitorId: "c1", plans, pageText, recordedAt: AT });
}

const usd = { currency: "USD", billing_period: "usage" as const };

// A real graduated page: "First 10,000 requests $0.10, next 40,000 $0.08,
// beyond that $0.05. $50 monthly minimum."
const GRADUATED: PricingPlan = {
  plan_name: "Scale",
  price: 0.1,
  unit: "API call",
  rate_structure: "graduated",
  minimum_amount: 50,
  tiers: [
    { from_qty: 0, to_qty: 10_000, unit_price: 0.1, flat_fee: null },
    { from_qty: 10_000, to_qty: 50_000, unit_price: 0.08, flat_fee: null },
    { from_qty: 50_000, to_qty: null, unit_price: 0.05, flat_fee: null },
  ],
  ...usd,
};

const pointAt = (rows: ReturnType<typeof prepare>["pointRows"], qty: number) =>
  rows.find((p) => p.reference_qty === qty);

describe("graduated page", () => {
  const result = prepare([GRADUATED]);

  test("stores every band as evidence, on the normalised meter", () => {
    expect(result.tierRows).toHaveLength(3);
    expect(result.tierRows.every((t) => t.unit === "request")).toBe(true);
    expect(result.tierRows.map((t) => t.from_qty)).toEqual([0, 10_000, 50_000]);
    expect(result.tierRows.every((t) => t.recorded_at === AT)).toBe(true);
  });

  test("costs the plan at every preset volume", () => {
    expect(result.pointRows.map((p) => p.reference_qty)).toEqual([
      1_000, 10_000, 100_000, 1_000_000,
    ]);
    // 1,000 x $0.10 = $100, under the $50 minimum's reach
    expect(pointAt(result.pointRows, 1_000)?.effective_monthly_cost).toBeCloseTo(100, 6);
    // 1000 + 3200 + 2500
    expect(pointAt(result.pointRows, 100_000)?.effective_monthly_cost).toBeCloseTo(6_700, 6);
    expect(result.pointRows.every((p) => p.method === "computed_from_tiers")).toBe(true);
    expect(result.pointRows.every((p) => p.meter_unit === "request")).toBe(true);
  });
});

describe("volume page", () => {
  test("the reached band's rate applies to everything", () => {
    const result = prepare([{ ...GRADUATED, rate_structure: "volume", minimum_amount: null }]);
    expect(pointAt(result.pointRows, 100_000)?.effective_monthly_cost).toBeCloseTo(5_000, 6);
    expect(pointAt(result.pointRows, 1_000)?.effective_monthly_cost).toBeCloseTo(100, 6);
  });
});

describe("package page — '$5 per 1,000 emails'", () => {
  const result = prepare([
    {
      plan_name: "Bulk email",
      price: 5,
      unit: "email",
      included_quantity: 1_000,
      rate_structure: "package",
      ...usd,
    },
  ]);

  test("prices in whole blocks, with no ladder to store", () => {
    expect(result.tierRows).toHaveLength(0);
    expect(pointAt(result.pointRows, 1_000)?.effective_monthly_cost).toBeCloseTo(5, 6);
    expect(pointAt(result.pointRows, 10_000)?.effective_monthly_cost).toBeCloseTo(50, 6);
    expect(pointAt(result.pointRows, 1_000_000)?.effective_monthly_cost).toBeCloseTo(5_000, 6);
    expect(result.pointRows[0]?.meter_unit).toBe("email");
  });
});

describe("percentage page — '2.9% + $0.30'", () => {
  test("carries its facts but never enters a volume band", () => {
    const result = prepare([
      {
        plan_name: "Payments",
        price: 0.3,
        unit: "transaction",
        rate_structure: "percentage",
        percentage_rate: 2.9,
        ...usd,
      },
    ]);
    // Its meter is money: a cost at 10,000 units would be a number with no meaning.
    expect(result.pointRows).toHaveLength(0);
    expect(result.tierRows).toHaveLength(0);
  });
});

describe("hybrid page — a base fee plus a meter", () => {
  const HYBRID: PricingPlan[] = [
    {
      plan_name: "Business",
      price: 99,
      currency: "USD",
      billing_period: "monthly",
      unit: null,
      included_quantity: null,
    },
    {
      plan_name: "Business",
      price: 0.05,
      unit: "API call",
      rate_structure: "standard",
      ...usd,
    },
  ];

  test("the effective cost carries the subscription the meter sits on", () => {
    const result = prepare(HYBRID);
    // 99 base + 10,000 x 0.05
    expect(pointAt(result.pointRows, 10_000)?.effective_monthly_cost).toBeCloseTo(599, 6);
  });

  test("an annual base is read on the same monthly axis", () => {
    const yearlyBase: PricingPlan[] = [
      { ...HYBRID[0]!, price: 1_200, billing_period: "yearly" },
      HYBRID[1]!,
    ];
    // 1200/12 = 100 base + 500 usage
    expect(pointAt(prepare(yearlyBase).pointRows, 10_000)?.effective_monthly_cost).toBeCloseTo(
      600,
      6,
    );
  });

  test("the subscription row itself is not a metered plan", () => {
    const result = prepare([HYBRID[0]!]);
    expect(result.pointRows).toHaveLength(0);
  });
});

describe("band edges", () => {
  test("a quantity exactly on a boundary is priced by the band that ends there", () => {
    const edges: PricingPlan = {
      ...GRADUATED,
      minimum_amount: null,
      tiers: [
        { from_qty: 0, to_qty: 10_000, unit_price: 0.1, flat_fee: null },
        { from_qty: 10_000, to_qty: null, unit_price: 0.01, flat_fee: null },
      ],
    };
    // 10,000 x 0.10, with nothing spilling into the cheap band
    expect(pointAt(prepare([edges]).pointRows, 10_000)?.effective_monthly_cost).toBeCloseTo(
      1_000,
      6,
    );
  });

  test("a free allowance is a band, and costs nothing inside it", () => {
    const freeFirst: PricingPlan = {
      ...GRADUATED,
      minimum_amount: null,
      tiers: [
        { from_qty: 0, to_qty: 10_000, unit_price: 0, flat_fee: null },
        { from_qty: 10_000, to_qty: null, unit_price: 0.1, flat_fee: null },
      ],
    };
    const result = prepare([freeFirst]);
    expect(pointAt(result.pointRows, 1_000)?.effective_monthly_cost).toBe(0);
    expect(pointAt(result.pointRows, 100_000)?.effective_monthly_cost).toBeCloseTo(9_000, 6);
  });

  test("the monthly minimum floors the cheap end", () => {
    const result = prepare([GRADUATED]);
    // 0 units would bill the $50 floor; the cheapest preset already clears it.
    expect(pointAt(result.pointRows, 1_000)?.effective_monthly_cost).toBeGreaterThan(50);
  });
});

describe("what is refused", () => {
  test("an invalid ladder is dropped whole — no bands, no costs", () => {
    const overlapping: PricingPlan = {
      ...GRADUATED,
      minimum_amount: null,
      tiers: [
        { from_qty: 0, to_qty: 10_000, unit_price: 0.1, flat_fee: null },
        { from_qty: 5_000, to_qty: 50_000, unit_price: 0.08, flat_fee: null },
      ],
    };
    const result = prepare([overlapping]);
    expect(result.tierRows).toHaveLength(0);
    expect(result.dropped.invalidLadders).toBe(1);
    // A graduated plan with no usable ladder has no cost to state either.
    expect(result.pointRows).toHaveLength(0);
  });

  test("a meter we cannot normalise keeps its bands but enters no comparison", () => {
    const exotic: PricingPlan = { ...GRADUATED, unit: "frobnication" };
    const result = prepare([exotic]);
    expect(result.tierRows).toHaveLength(3);
    expect(result.tierRows[0]?.unit).toBe("frobnication");
    expect(result.pointRows).toHaveLength(0);
    expect(result.dropped.unknownUnits).toBe(1);
  });

  test("a worked example the page never printed is dropped", () => {
    const withExamples: PricingPlan = {
      ...GRADUATED,
      cost_examples: [
        { qty: 1_000_000, cost: 25 },
        { qty: 500_000, cost: 9_999 },
      ],
    };
    const page = "Estimate: about $25 for 1,000,000 requests per month.";
    const result = prepare([withExamples], page);
    const published = result.pointRows.filter((p) => p.method === "published");
    expect(published).toHaveLength(1);
    expect(published[0]?.effective_monthly_cost).toBe(25);
    expect(published[0]?.reference_qty).toBe(1_000_000);
    expect(result.dropped.ungroundedExamples).toBe(1);
  });

  test("a plan with no meter at all produces nothing", () => {
    const result = prepare([
      {
        plan_name: "Pro",
        price: 29,
        currency: "USD",
        billing_period: "monthly",
        unit: null,
        included_quantity: null,
      },
    ]);
    expect(result).toEqual({
      tierRows: [],
      pointRows: [],
      dropped: { invalidLadders: 0, unknownUnits: 0, ungroundedExamples: 0 },
    });
  });
});
