import { describe, expect, test } from "bun:test";
import {
  computeLandscapeInsights,
  type InsightPricingRow,
} from "../src/lib/landscape-insights";

const COMPS = [
  { id: "a", name: "Acme" },
  { id: "b", name: "Bolt" },
];

function pricingRow(partial: Partial<InsightPricingRow> & { competitorId: string }): InsightPricingRow {
  return {
    planName: "Pro",
    price: null,
    currency: "USD",
    billingPeriod: "monthly",
    hasTrial: null,
    trialDays: null,
    ...partial,
  };
}

const EMPTY = { competitors: COMPS, pricing: [], selfPricing: [], hiring: [], reviews: [] };

describe("computeLandscapeInsights", () => {
  test("returns nothing on empty data", () => {
    expect(computeLandscapeInsights(EMPTY)).toEqual([]);
  });

  test("pricing gap picks the largest ≥10% entry-plan delta vs self", () => {
    const out = computeLandscapeInsights({
      ...EMPTY,
      pricing: [
        pricingRow({ competitorId: "a", planName: "Starter", price: 49 }),
        pricingRow({ competitorId: "b", planName: "Basic", price: 41 }), // ~5% — below threshold
      ],
      selfPricing: [pricingRow({ competitorId: "self", planName: "Solo", price: 39 })],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("pricing_gap");
    expect(out[0]?.competitorId).toBe("a");
    expect(out[0]?.text).toContain("26% above yours");
    expect(out[0]?.text).toContain("$49");
    expect(out[0]?.text).toContain("$39");
  });

  test("pricing gap skips cross-currency comparisons", () => {
    const out = computeLandscapeInsights({
      ...EMPTY,
      pricing: [pricingRow({ competitorId: "a", price: 99, currency: "EUR" })],
      selfPricing: [pricingRow({ competitorId: "self", price: 39, currency: "USD" })],
    });
    expect(out.filter((i) => i.kind === "pricing_gap")).toHaveLength(0);
  });

  test("trial insight contrasts with self only when self pricing exists", () => {
    const withSelf = computeLandscapeInsights({
      ...EMPTY,
      pricing: [pricingRow({ competitorId: "a", hasTrial: true, trialDays: 14 })],
      selfPricing: [pricingRow({ competitorId: "self", price: 39, hasTrial: false })],
    });
    expect(withSelf[0]?.kind).toBe("trial");
    expect(withSelf[0]?.text).toBe(
      "Acme offers a 14-day free trial — you don't advertise one.",
    );

    const withoutSelf = computeLandscapeInsights({
      ...EMPTY,
      pricing: [pricingRow({ competitorId: "a", hasTrial: true, trialDays: null })],
    });
    expect(withoutSelf[0]?.text).toBe("Acme offers a free trial.");
  });

  test("hiring requires ≥3 open roles and names the top department", () => {
    const out = computeLandscapeInsights({
      ...EMPTY,
      hiring: [
        { competitorId: "a", total: 2, topDepartment: "Sales" },
        { competitorId: "b", total: 12, topDepartment: "Engineering" },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe(
      "Bolt has 12 open roles right now — the most active hirer you track (mostly Engineering).",
    );
  });

  test("reviews requires ≥5 reviews and labels the source", () => {
    const out = computeLandscapeInsights({
      ...EMPTY,
      reviews: [
        { competitorId: "a", source: "g2", score: 4.9, reviewCount: 2 }, // too few
        { competitorId: "b", source: "capterra", score: 4.6, reviewCount: 210 },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe("Bolt scores 4.6/5 on Capterra across 210 reviews.");
  });

  test("caps at 3 insights, pricing first", () => {
    const out = computeLandscapeInsights({
      competitors: COMPS,
      pricing: [pricingRow({ competitorId: "a", price: 59, hasTrial: true, trialDays: 7 })],
      selfPricing: [pricingRow({ competitorId: "self", price: 39 })],
      hiring: [{ competitorId: "b", total: 8, topDepartment: null }],
      reviews: [{ competitorId: "a", source: "g2", score: 4.2, reviewCount: 50 }],
    });
    expect(out).toHaveLength(3);
    expect(out.map((i) => i.kind)).toEqual(["pricing_gap", "trial", "hiring"]);
  });

  test("ignores rows from competitors outside the roster", () => {
    const out = computeLandscapeInsights({
      ...EMPTY,
      hiring: [{ competitorId: "ghost", total: 40, topDepartment: null }],
      reviews: [{ competitorId: "ghost", source: "g2", score: 5, reviewCount: 99 }],
    });
    expect(out).toEqual([]);
  });
});
