import { test, expect } from "bun:test";
import { reconcileBillingPeriods } from "./normalize-periods";

const plan = (plan_name: string, price: number | null, billing_period: string) => ({
  plan_name,
  price,
  billing_period,
});

test("yearly cheaper than monthly is a per-month rate → annual total", () => {
  const out = reconcileBillingPeriods([
    plan("Pro", 20, "monthly"),
    plan("Pro", 16, "yearly"),
  ]);
  expect(out).toEqual([plan("Pro", 20, "monthly"), plan("Pro", 192, "yearly")]);
});

test("a real annual total is left alone", () => {
  const plans = [plan("Pro", 20, "monthly"), plan("Pro", 200, "yearly")];
  expect(reconcileBillingPeriods(plans)).toEqual(plans);
});

test("equal monthly and yearly figures are not multiplied", () => {
  // A duplicate, not a discount: x12 would invent a price the page never showed.
  const plans = [plan("Pro", 20, "monthly"), plan("Pro", 20, "yearly")];
  expect(reconcileBillingPeriods(plans)).toEqual(plans);
});

test("lone yearly the page prints as /mo with an annual term → both rows", () => {
  const text = "Pro $16/mo billed annually — $192 per year. Get started";
  const out = reconcileBillingPeriods([plan("Pro", 16, "yearly")], text);
  expect(out).toEqual([plan("Pro", 16, "monthly"), plan("Pro", 192, "yearly")]);
});

test("lone yearly the page prints as /mo with no annual term → monthly only", () => {
  const out = reconcileBillingPeriods([plan("Pro", 39, "yearly")], "Pro $39/mo. Sign up");
  expect(out).toEqual([plan("Pro", 39, "monthly")]);
});

test("an amount the page prints as /yr keeps its period", () => {
  const out = reconcileBillingPeriods([plan("Pro", 192, "yearly")], "Pro $192/yr billed annually");
  expect(out).toEqual([plan("Pro", 192, "yearly")]);
});

test("an amount followed by both tokens ($1,188/year ($99/mo)) stays yearly", () => {
  const out = reconcileBillingPeriods(
    [plan("Pro", 1188, "yearly")],
    "Pro $1,188/year ($99/mo) billed annually",
  );
  expect(out).toEqual([plan("Pro", 1188, "yearly")]);
});

test("a substring of a larger number is not evidence", () => {
  // "16" must not match inside "$160/mo" and demote the yearly row.
  const out = reconcileBillingPeriods([plan("Pro", 16, "yearly")], "Enterprise $160/mo");
  expect(out).toEqual([plan("Pro", 16, "yearly")]);
});

test("thousands separators and trailing cents match the printed amount", () => {
  const out = reconcileBillingPeriods(
    [plan("Scale", 1299, "yearly")],
    "Scale 1 299,00 € par mois, facturés annuellement",
  );
  expect(out).toEqual([plan("Scale", 1299, "monthly"), plan("Scale", 15588, "yearly")]);
});

test("a sound annual total is never re-read from a same-number monthly elsewhere", () => {
  // Pro's $200/year is arithmetically fine; the "$200/mo" belongs to another plan.
  const plans = [plan("Pro", 20, "monthly"), plan("Pro", 200, "yearly")];
  expect(reconcileBillingPeriods(plans, "Pro $20/mo or $200/year. Scale $200/mo")).toEqual(
    plans,
  );
});

test("plans are matched by name, not across the table", () => {
  const out = reconcileBillingPeriods([
    plan("Starter", 10, "monthly"),
    plan("Pro", 8, "yearly"), // cheaper than Starter's monthly, but a different plan
  ]);
  expect(out).toEqual([plan("Starter", 10, "monthly"), plan("Pro", 8, "yearly")]);
});

test("non-yearly rows pass through untouched", () => {
  const plans = [
    plan("Enterprise", null, "custom"),
    plan("Credits", 99, "one_time"),
    plan("API", 0.1, "usage"),
  ];
  expect(reconcileBillingPeriods(plans, "Enterprise contact sales")).toEqual(plans);
});

test("idempotent — a repaired result does not move again", () => {
  const text = "Pro $16/mo billed annually";
  const once = reconcileBillingPeriods([plan("Pro", 16, "yearly")], text);
  expect(reconcileBillingPeriods(once, text)).toEqual(once);
});

test("extra fields on a plan survive the rewrite", () => {
  const [row] = reconcileBillingPeriods([
    { plan_name: "Pro", price: 20, billing_period: "monthly", currency: "USD", unit: "seat" },
    { plan_name: "Pro", price: 16, billing_period: "yearly", currency: "USD", unit: "seat" },
  ]).slice(1);
  expect(row).toEqual({
    plan_name: "Pro",
    price: 192,
    billing_period: "yearly",
    currency: "USD",
    unit: "seat",
  });
});
