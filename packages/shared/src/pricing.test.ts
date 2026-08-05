import { test, expect } from "bun:test";
import {
  entryPrice,
  normalizePlanKey,
  priceMedian,
  resolveCurrentPricing,
  sharedLadderAxes,
  looksLikeCatalog,
  compareLadderSpans,
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

// ─── price position (products portfolio + product Pricing tab) ───────────────

test("entry price is the cheapest paid monthly tier", () => {
  expect(entryPrice([T("Free", 0), T("Pro", 49), T("Business", 199)])).toEqual({
    planName: "Pro",
    price: 49,
    currency: "USD",
    billingPeriod: "monthly",
  });
});

test("entry price ignores free and quote-based tiers", () => {
  expect(entryPrice([T("Free", 0), T("Enterprise", null)])).toBeNull();
});

test("entry price falls back to yearly only when no monthly tier is published", () => {
  const out = entryPrice([T("Annual", 490, "yearly"), T("Enterprise", null, "custom")]);
  expect(out).toMatchObject({ price: 490, billingPeriod: "yearly" });
});

test("a monthly tier wins over a cheaper yearly one, so periods never mix", () => {
  const out = entryPrice([T("Annual", 20, "yearly"), T("Pro", 49)]);
  expect(out).toMatchObject({ price: 49, billingPeriod: "monthly" });
});

test("usage rates never become an entry price", () => {
  expect(entryPrice([T("Metered", 0.004, "usage")])).toBeNull();
});

test("entry price of an empty table is null, not zero", () => {
  expect(entryPrice([])).toBeNull();
});

test("median takes the middle of an odd sample and the mean of the two middles", () => {
  expect(priceMedian([99, 49, 199])).toBe(99);
  expect(priceMedian([49, 99, 149, 199])).toBe(124);
});

test("median of one price is that price, of none is null", () => {
  expect(priceMedian([99])).toBe(99);
  expect(priceMedian([])).toBeNull();
});

test("a shared axis needs a PRICED row on both sides", () => {
  // seorce (monthly SaaS) vs visiblie (one-off audit + monthly retainers).
  expect(sharedLadderAxes(["monthly", "monthly"], ["one_time", "monthly"])).toEqual(["monthly"]);
  // A one-off service menu on both sides is a real shared axis, not a mismatch.
  expect(sharedLadderAxes(["one_time"], ["one_time", "one_time"])).toEqual(["one_time"]);
  // Monthly against a pure one-off menu shares nothing.
  expect(sharedLadderAxes(["monthly"], ["one_time"])).toEqual([]);
  // Preference order holds when several axes qualify.
  expect(sharedLadderAxes(["yearly", "monthly"], ["monthly", "yearly"])).toEqual([
    "monthly",
    "yearly",
  ]);
});

test("usage rates never open an axis", () => {
  expect(sharedLadderAxes(["usage"], ["usage"])).toEqual([]);
});

test("a catalogue of items is not a tier ladder", () => {
  // 12 trading cards (CardNexus), 14 domain TLDs (netcup) — no rung anywhere.
  expect(looksLikeCatalog(["Mind Rune", "Defiler Spire", "Falling Star"])).toBe(true);
  // `From` / `Up to` are column headers the extractor mistook for plans.
  expect(looksLikeCatalog(["From", "Up to"])).toBe(true);
  // Two separately-priced products on one page (Galaxy: Mongodb, Redis).
  expect(looksLikeCatalog(["Mongodb · Free", "Redis · Basic"])).toBe(true);
});

test("a real ladder survives, even a sparsely named one", () => {
  expect(looksLikeCatalog(["Free", "Pro", "Enterprise"])).toBe(false);
  // One rung word anywhere is enough: Back4app's MVP / Pay as You Go / Dedicated.
  expect(looksLikeCatalog(["Free", "MVP", "Pay as You Go", "Dedicated", "Enterprise"])).toBe(false);
  // Two unlabelled plans stay a ladder: too small a sample to call it a catalogue.
  expect(looksLikeCatalog(["On Cloud", "On Premises"])).toBe(false);
  expect(looksLikeCatalog([])).toBe(false);
});

test("ladders that never touch report the distance, not an overlap", () => {
  // holofolio $1.99-$19.90 against Pulltrader $300-$3000.
  expect(compareLadderSpans([1.99, 19.9], [300, 3000])).toEqual({
    kind: "above",
    ratio: 300 / 19.9,
  });
  // Reversed: our whole ladder above theirs.
  expect(compareLadderSpans([300, 3000], [1.99, 19.9])).toEqual({
    kind: "below",
    ratio: 300 / 19.9,
  });
});

test("adjacent ranges still count as disjoint", () => {
  // capydex $19.90 top against Prodmap.ai $20 entry: a 1.005x gap, but no rung
  // of ours sits inside theirs, so rank pairing has nothing to pair.
  const rel = compareLadderSpans([1.99, 19.9], [20, 500]);
  expect(rel?.kind).toBe("above");
});

test("touching ranges overlap", () => {
  expect(compareLadderSpans([29, 99], [29, 99])).toEqual({ kind: "overlap" });
  expect(compareLadderSpans([10, 880], [29, 59])).toEqual({ kind: "overlap" });
});

test("a span needs a paid rung on both sides", () => {
  expect(compareLadderSpans([], [29])).toBeNull();
  expect(compareLadderSpans([29], [])).toBeNull();
});
