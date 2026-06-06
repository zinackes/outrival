import { test, expect } from "bun:test";
import { pricingRatiosPlausible } from "./validate-ratios";

const plan = (plan_name: string, price: number | null, billing_period: string) => ({
  plan_name,
  price,
  billing_period,
});

test("annual total ~10× monthly is plausible", () => {
  expect(
    pricingRatiosPlausible([plan("Pro", 20, "monthly"), plan("Pro", 200, "yearly")]),
  ).toBe(true);
});

test("annual total at full 12× is plausible", () => {
  expect(
    pricingRatiosPlausible([plan("Pro", 20, "monthly"), plan("Pro", 240, "yearly")]),
  ).toBe(true);
});

test("yearly shown as discounted per-month rate is plausible", () => {
  expect(
    pricingRatiosPlausible([plan("Pro", 20, "monthly"), plan("Pro", 16, "yearly")]),
  ).toBe(true);
});

test("dead-zone ratio (3×) is a mis-parse → implausible", () => {
  expect(
    pricingRatiosPlausible([plan("Pro", 20, "monthly"), plan("Pro", 60, "yearly")]),
  ).toBe(false);
});

test("yearly absurdly larger than 12× → implausible", () => {
  expect(
    pricingRatiosPlausible([plan("Pro", 20, "monthly"), plan("Pro", 2400, "yearly")]),
  ).toBe(false);
});

test("single-period plans cannot be disproven → plausible", () => {
  expect(
    pricingRatiosPlausible([plan("Pro", 20, "monthly"), plan("Team", 50, "monthly")]),
  ).toBe(true);
});

test("quote-based / null prices are ignored", () => {
  expect(
    pricingRatiosPlausible([plan("Enterprise", null, "custom"), plan("Pro", 20, "monthly")]),
  ).toBe(true);
});

test("one bad plan among several fails the whole result", () => {
  expect(
    pricingRatiosPlausible([
      plan("Starter", 10, "monthly"),
      plan("Starter", 100, "yearly"), // ok ~10×
      plan("Pro", 30, "monthly"),
      plan("Pro", 90, "yearly"), // 3× → mis-parse
    ]),
  ).toBe(false);
});
