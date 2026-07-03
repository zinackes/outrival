import { test, expect } from "bun:test";
import {
  normalizePlanKey,
  resolveCurrentPricing,
  type PricingTier,
  type CompetitorOverrides,
} from "./pricing";

const T = (planName: string, price: number | null, billingPeriod = "monthly"): PricingTier => ({
  planName,
  price,
  currency: "USD",
  billingPeriod,
});

// ─── per-plan pricing overlay merge (competitor content editing) ─────────────

test("no overrides → detected batch passes through untouched", () => {
  const detected = [T("Free", 0), T("Pro", 20)];
  const out = resolveCurrentPricing(detected, null);
  expect(out).toEqual([
    { ...T("Free", 0), origin: "detected", locked: false },
    { ...T("Pro", 20), origin: "detected", locked: false },
  ]);
});

test("edit locks one plan and leaves the rest flowing from detection", () => {
  const detected = [T("Free", 0), T("Pro", 20)];
  const overrides: CompetitorOverrides = {
    pricingPlans: [
      { planKey: normalizePlanKey("Pro"), action: "edit", value: T("Pro", 25), lastEditedByUserAt: "2026-07-03T00:00:00Z" },
    ],
  };
  const out = resolveCurrentPricing(detected, overrides);
  expect(out[0]).toMatchObject({ planName: "Free", origin: "detected", locked: false });
  // Locked value wins; detection ($20) diverges from the locked $25 → drift surfaced.
  expect(out[1]).toMatchObject({ planName: "Pro", price: 25, origin: "edited", locked: true });
  expect(out[1]?.drift).toEqual(T("Pro", 20));
});

test("edit with no divergence carries no drift", () => {
  const detected = [T("Pro", 20)];
  const overrides: CompetitorOverrides = {
    pricingPlans: [
      { planKey: normalizePlanKey("Pro"), action: "edit", value: T("Pro", 20), lastEditedByUserAt: "x" },
    ],
  };
  expect(resolveCurrentPricing(detected, overrides)[0]?.drift).toBeUndefined();
});

test("hide drops a detected plan", () => {
  const detected = [T("Free", 0), T("Pro", 20)];
  const overrides: CompetitorOverrides = {
    pricingPlans: [{ planKey: normalizePlanKey("Free"), action: "hide", lastEditedByUserAt: "x" }],
  };
  const out = resolveCurrentPricing(detected, overrides);
  expect(out.map((p) => p.planName)).toEqual(["Pro"]);
});

test("add appends a plan the scraper never saw", () => {
  const detected = [T("Pro", 20)];
  const overrides: CompetitorOverrides = {
    pricingPlans: [
      { planKey: normalizePlanKey("Enterprise"), action: "add", value: T("Enterprise", null), lastEditedByUserAt: "x" },
    ],
  };
  const out = resolveCurrentPricing(detected, overrides);
  expect(out[1]).toMatchObject({ planName: "Enterprise", price: null, origin: "added", locked: true });
});

test("a new detected plan appears on its own without any override", () => {
  const detected = [T("Free", 0), T("Pro", 20), T("Team", 50)];
  const overrides: CompetitorOverrides = {
    pricingPlans: [{ planKey: normalizePlanKey("Pro"), action: "edit", value: T("Pro", 25), lastEditedByUserAt: "x" }],
  };
  const out = resolveCurrentPricing(detected, overrides);
  expect(out.map((p) => p.planName)).toEqual(["Free", "Pro", "Team"]);
  expect(out[2]).toMatchObject({ planName: "Team", locked: false });
});

test("an edited plan the source stopped showing is kept with noLongerDetected", () => {
  const detected = [T("Free", 0)];
  const overrides: CompetitorOverrides = {
    pricingPlans: [
      { planKey: normalizePlanKey("Legacy"), action: "edit", value: T("Legacy", 99), lastEditedByUserAt: "x" },
    ],
  };
  const out = resolveCurrentPricing(detected, overrides);
  expect(out[1]).toMatchObject({ planName: "Legacy", origin: "edited", locked: true, noLongerDetected: true });
});

test("plan key matching is case/whitespace insensitive", () => {
  const detected = [T("Pro  Plan", 20)];
  const overrides: CompetitorOverrides = {
    pricingPlans: [
      { planKey: normalizePlanKey("pro plan"), action: "edit", value: T("Pro Plan", 30), lastEditedByUserAt: "x" },
    ],
  };
  const out = resolveCurrentPricing(detected, overrides);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ price: 30, origin: "edited", locked: true });
});
