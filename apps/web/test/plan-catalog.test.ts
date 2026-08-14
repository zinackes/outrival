import { describe, expect, it } from "bun:test";
import {
  PLAN_LIMITS,
  PLAN_PRICING,
  PLANS,
  planIncludesFeature,
} from "@outrival/shared";
import { PLAN_CARDS, planPrice } from "../src/lib/plan-catalog";

describe("PLAN_CARDS", () => {
  it("covers every plan with sellable copy", () => {
    for (const plan of PLANS) {
      const card = PLAN_CARDS[plan];
      expect(card.desc.length).toBeGreaterThan(0);
      expect(card.cta.length).toBeGreaterThan(0);
      expect(card.features.length).toBeGreaterThan(0);
    }
  });

  it("marks exactly one plan as most popular", () => {
    expect(PLANS.filter((p) => PLAN_CARDS[p].featured)).toEqual(["pro"]);
  });

  it("reads as additive: every paid tier names the one below it", () => {
    expect(PLAN_CARDS.free.includes).toBeUndefined();
    expect(PLAN_CARDS.starter.includes).toContain("Free");
    expect(PLAN_CARDS.pro.includes).toContain("Starter");
    expect(PLAN_CARDS.business.includes).toContain("Pro");
  });

  // The drift this module exists to stop: a bullet promising a competitor count
  // the gate would refuse.
  it("quotes the competitor cap PLAN_LIMITS enforces", () => {
    for (const plan of PLANS) {
      const cap = PLAN_LIMITS[plan].maxCompetitors;
      expect(PLAN_CARDS[plan].features).toContain(`${cap} competitors`);
    }
  });

  // Billing used to sell "Multi-user · API access" on Business while both flags
  // were false on every plan.
  it("sells no feature its plan does not own", () => {
    for (const plan of PLANS) {
      const text = PLAN_CARDS[plan].features.join(" ").toLowerCase();
      if (text.includes("api")) expect(planIncludesFeature(plan, "api")).toBe(true);
      if (text.includes("multi-user"))
        expect(planIncludesFeature(plan, "multiUser")).toBe(true);
      if (text.includes("real-time"))
        expect(planIncludesFeature(plan, "realtimeAlerts")).toBe(true);
    }
  });
});

describe("planPrice", () => {
  it("charges nothing for free on either period", () => {
    expect(planPrice("free", "monthly")).toEqual({ perMonth: 0, total: 0 });
    expect(planPrice("free", "yearly")).toEqual({ perMonth: 0, total: 0 });
  });

  it("bills the PLAN_PRICING row, never a copy of it", () => {
    for (const plan of ["starter", "pro", "business"] as const) {
      expect(planPrice(plan, "monthly").total).toBe(PLAN_PRICING[plan].monthly);
      expect(planPrice(plan, "yearly").total).toBe(PLAN_PRICING[plan].yearly);
    }
  });

  it("shows a yearly plan as its monthly equivalent", () => {
    // 790 / 12 = 65.83 → the card headline is a round number, the invoice is not.
    expect(planPrice("pro", "yearly")).toEqual({ perMonth: 66, total: 790 });
    expect(planPrice("pro", "monthly")).toEqual({ perMonth: 79, total: 79 });
  });
});
