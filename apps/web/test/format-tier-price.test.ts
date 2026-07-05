import { test, expect } from "bun:test";
import { formatTierPrice } from "../src/app/dashboard/competitors/[id]/competitor-detail/helpers";

test("formatTierPrice renders subscription, custom and free tiers", () => {
  expect(formatTierPrice({ price: 29, currency: "USD", billing_period: "monthly" })).toBe("$29/mo");
  expect(formatTierPrice({ price: 290, currency: "EUR", billing_period: "yearly" })).toBe("€290/yr");
  expect(formatTierPrice({ price: null, currency: "USD", billing_period: "custom" })).toBe("Custom");
  expect(formatTierPrice({ price: 0, currency: "USD", billing_period: "monthly" })).toBe("Free");
});

test("formatTierPrice renders a usage rate with its unit", () => {
  expect(
    formatTierPrice({ price: 0.1, currency: "USD", billing_period: "usage", unit: "API call" }),
  ).toBe("$0.1 / API call");
  // A $0 usage rate is a rate, not a free plan.
  expect(formatTierPrice({ price: 0, currency: "USD", billing_period: "usage" })).toBe("$0 / use");
});

test("formatTierPrice renders a credit pack with its bundled quantity", () => {
  expect(
    formatTierPrice({
      price: 99,
      currency: "USD",
      billing_period: "one_time",
      unit: "credit",
      includedQuantity: 1000,
    }),
  ).toBe("$99 · 1,000 credits");
});
