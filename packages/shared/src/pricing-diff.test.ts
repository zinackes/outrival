import { test, expect, describe } from "bun:test";
import {
  diffPricingBatches,
  maxPricingChangeSeverity,
  formatPrice,
  type PricingBatchRow,
} from "./pricing-diff";

// Fixture vocabulary mirrors normalize-periods: monthly rates, annual totals
// (12x), usage rates with a unit — the canon every batch obeys post-reconcile.
const row = (partial: Partial<PricingBatchRow> & { plan_name: string }): PricingBatchRow => ({
  price: null,
  currency: "USD",
  billing_period: "monthly",
  ...partial,
});

const pro79 = row({ plan_name: "Pro", price: 79 });
const starter29 = row({ plan_name: "Starter", price: 29 });

describe("price_changed", () => {
  test("a drop beyond 15% is a critical undercut", () => {
    const changes = diffPricingBatches([pro79], [row({ plan_name: "Pro", price: 59 })]);
    expect(changes).toHaveLength(1);
    const c = changes[0]!;
    expect(c.type).toBe("price_changed");
    expect(c.severity).toBe("critical");
    expect(c.direction).toBe("down");
    expect(c.pctChange).toBe(-25.3);
    expect(c.humanBefore).toBe("Pro — $79/mo");
    expect(c.humanAfter).toBe("Pro — $59/mo");
    expect(c.summary).toBe("Pro: $79/mo → $59/mo (−25.3%)");
  });

  test("a drop of exactly 15% is medium, not critical (strict boundary)", () => {
    const changes = diffPricingBatches(
      [row({ plan_name: "Pro", price: 100 })],
      [row({ plan_name: "Pro", price: 85 })],
    );
    expect(changes[0]!.severity).toBe("medium");
  });

  test("a move under 3% is low", () => {
    const changes = diffPricingBatches(
      [row({ plan_name: "Pro", price: 100 })],
      [row({ plan_name: "Pro", price: 102 })],
    );
    expect(changes[0]!.severity).toBe("low");
    expect(changes[0]!.direction).toBe("up");
  });

  test("a 3% move is medium (inclusive boundary)", () => {
    const changes = diffPricingBatches(
      [row({ plan_name: "Pro", price: 100 })],
      [row({ plan_name: "Pro", price: 103 })],
    );
    expect(changes[0]!.severity).toBe("medium");
  });

  test("a large increase stays medium — only an undercut pages", () => {
    const changes = diffPricingBatches(
      [row({ plan_name: "Pro", price: 100 })],
      [row({ plan_name: "Pro", price: 150 })],
    );
    expect(changes[0]!.severity).toBe("medium");
  });

  test("plan names match case- and whitespace-insensitively", () => {
    const changes = diffPricingBatches(
      [row({ plan_name: "Pro  Plan", price: 79 })],
      [row({ plan_name: "pro plan", price: 59 })],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.type).toBe("price_changed");
  });

  test("monthly and yearly rows of one plan are separate comparisons", () => {
    const changes = diffPricingBatches(
      [pro79, row({ plan_name: "Pro", price: 790, billing_period: "yearly" })],
      [pro79, row({ plan_name: "Pro", price: 948, billing_period: "yearly" })],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.billingPeriod).toBe("yearly");
    expect(changes[0]!.humanAfter).toBe("Pro — $948/yr");
  });

  test("a currency swap is not a price change", () => {
    const changes = diffPricingBatches(
      [row({ plan_name: "Pro", price: 79, currency: "USD" })],
      [row({ plan_name: "Pro", price: 75, currency: "EUR" })],
    );
    expect(changes).toHaveLength(0);
  });

  test("an unchanged batch yields nothing", () => {
    expect(diffPricingBatches([pro79, starter29], [pro79, starter29])).toHaveLength(0);
  });
});

describe("promotional exclusion", () => {
  test("a promo next row never fires price_changed (struck-through Black Friday price)", () => {
    const changes = diffPricingBatches(
      [pro79],
      [row({ plan_name: "Pro", price: 39, promotional: 1 })],
    );
    expect(changes).toHaveLength(0);
  });

  test("a promo PREVIOUS row is no baseline — post-promo return to list is not a hike", () => {
    const changes = diffPricingBatches(
      [row({ plan_name: "Pro", price: 39, promotional: 1 })],
      [pro79],
    );
    expect(changes).toHaveLength(0);
  });

  test("a promo row still counts for plan presence (no false plan_removed)", () => {
    const changes = diffPricingBatches(
      [pro79],
      [row({ plan_name: "Pro", price: 39, promotional: true })],
    );
    expect(changes.filter((c) => c.type === "plan_removed")).toHaveLength(0);
  });
});

describe("plan_added / plan_removed", () => {
  test("a new plan name is high, with the exact price on the after side", () => {
    const changes = diffPricingBatches(
      [pro79],
      [pro79, row({ plan_name: "Scale", price: 199 })],
    );
    expect(changes).toHaveLength(1);
    const c = changes[0]!;
    expect(c.type).toBe("plan_added");
    expect(c.severity).toBe("high");
    expect(c.humanBefore).toBeNull();
    expect(c.humanAfter).toBe("Scale — $199/mo");
  });

  test("a vanished plan name is high, with the exact price on the before side", () => {
    const changes = diffPricingBatches([pro79, starter29], [pro79]);
    expect(changes).toHaveLength(1);
    const c = changes[0]!;
    expect(c.type).toBe("plan_removed");
    expect(c.humanBefore).toBe("Starter — $29/mo");
    expect(c.humanAfter).toBeNull();
  });

  test("a quote-based plan (price null) can appear and disappear", () => {
    const enterprise = row({ plan_name: "Enterprise", price: null, billing_period: "custom" });
    const added = diffPricingBatches([pro79], [pro79, enterprise]);
    expect(added[0]!.type).toBe("plan_added");
    expect(added[0]!.humanAfter).toBe("Enterprise");
  });

  test("either side empty yields nothing (first scrape / failed capture)", () => {
    expect(diffPricingBatches([], [pro79])).toHaveLength(0);
    expect(diffPricingBatches([pro79], [])).toHaveLength(0);
  });
});

describe("period_added", () => {
  test("yearly billing appearing on an existing plan is medium", () => {
    const changes = diffPricingBatches(
      [pro79],
      [pro79, row({ plan_name: "Pro", price: 790, billing_period: "yearly" })],
    );
    expect(changes).toHaveLength(1);
    const c = changes[0]!;
    expect(c.type).toBe("period_added");
    expect(c.severity).toBe("medium");
    expect(c.summary).toBe("Pro: yearly billing added ($790/yr)");
  });

  test("a usage overage appearing on a subscription plan reads as usage-based billing", () => {
    const changes = diffPricingBatches(
      [pro79],
      [pro79, row({ plan_name: "Pro", price: 0.1, billing_period: "usage", unit: "API call" })],
    );
    expect(changes[0]!.type).toBe("period_added");
    expect(changes[0]!.summary).toContain("usage-based billing added");
    expect(changes[0]!.summary).toContain("$0.1/API call");
  });

  test("a NEW plan's periods are not double-reported as period_added", () => {
    const changes = diffPricingBatches(
      [pro79],
      [
        pro79,
        row({ plan_name: "Scale", price: 199 }),
        row({ plan_name: "Scale", price: 1990, billing_period: "yearly" }),
      ],
    );
    expect(changes.map((c) => c.type)).toEqual(["plan_added"]);
  });
});

describe("rate_changed", () => {
  const rate10 = row({
    plan_name: "API",
    price: 0.1,
    billing_period: "usage",
    unit: "API call",
  });

  test("a usage rate drop beyond 15% is critical", () => {
    const changes = diffPricingBatches(
      [rate10],
      [{ ...rate10, price: 0.08 }],
    );
    const c = changes[0]!;
    expect(c.type).toBe("rate_changed");
    expect(c.severity).toBe("critical");
    expect(c.summary).toBe("API: $0.1/API call → $0.08/API call (−20%)");
  });

  test("a small rate move is medium — no low band on rates", () => {
    const changes = diffPricingBatches([rate10], [{ ...rate10, price: 0.101 }]);
    expect(changes[0]!.type).toBe("rate_changed");
    expect(changes[0]!.severity).toBe("medium");
  });

  test("a rate whose unit changed is not comparable", () => {
    const changes = diffPricingBatches(
      [rate10],
      [{ ...rate10, price: 0.2, unit: "resolved ticket" }],
    );
    expect(changes.filter((c) => c.type === "rate_changed")).toHaveLength(0);
  });
});

describe("included_quantity_changed", () => {
  const proQuota = row({
    plan_name: "Pro",
    price: 79,
    unit: "API calls",
    included_quantity: 10_000,
  });

  test("bundle shrinks at the same price → high (shrinkflation)", () => {
    const changes = diffPricingBatches(
      [proQuota],
      [{ ...proQuota, included_quantity: 5_000 }],
    );
    expect(changes).toHaveLength(1);
    const c = changes[0]!;
    expect(c.type).toBe("included_quantity_changed");
    expect(c.severity).toBe("high");
    expect(c.pctChange).toBe(-50);
    expect(c.humanBefore).toBe("Pro — 10,000 API calls included");
    expect(c.humanAfter).toBe("Pro — 5,000 API calls included, price unchanged");
  });

  test("bundle grows at the same price → medium (more value)", () => {
    const changes = diffPricingBatches(
      [proQuota],
      [{ ...proQuota, included_quantity: 20_000 }],
    );
    expect(changes[0]!.severity).toBe("medium");
    expect(changes[0]!.direction).toBe("up");
  });

  test("bundle shrinks WITH a price change → medium quantity + its own price change", () => {
    const changes = diffPricingBatches(
      [proQuota],
      [{ ...proQuota, price: 59, included_quantity: 5_000 }],
    );
    const types = changes.map((c) => c.type).sort();
    expect(types).toEqual(["included_quantity_changed", "price_changed"]);
    const qty = changes.find((c) => c.type === "included_quantity_changed")!;
    expect(qty.severity).toBe("medium");
  });

  test("a side without quantities never fires (predates dimensional capture)", () => {
    const changes = diffPricingBatches([pro79], [{ ...proQuota }]);
    expect(changes.filter((c) => c.type === "included_quantity_changed")).toHaveLength(0);
  });
});

describe("trial_changed / free_plan_changed", () => {
  const stamped = (
    partial: Partial<PricingBatchRow>,
  ): PricingBatchRow[] => [row({ plan_name: "Pro", price: 79, ...partial })];

  test("trial length moving is medium with exact phrases", () => {
    const changes = diffPricingBatches(
      stamped({ has_trial: 1, trial_days: 14, trial_requires_card: 0 }),
      stamped({ has_trial: 1, trial_days: 7, trial_requires_card: 0 }),
    );
    expect(changes).toHaveLength(1);
    const c = changes[0]!;
    expect(c.type).toBe("trial_changed");
    expect(c.severity).toBe("medium");
    expect(c.humanBefore).toBe("14-day free trial, no credit card required");
    expect(c.humanAfter).toBe("7-day free trial, no credit card required");
  });

  test("a trial appearing fires; an unknown card requirement is not a change", () => {
    const changes = diffPricingBatches(
      stamped({ has_trial: 0 }),
      stamped({ has_trial: 1, trial_days: 30 }),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.humanBefore).toBe("No free trial");
    expect(changes[0]!.humanAfter).toBe("30-day free trial");

    const unknownCard = diffPricingBatches(
      stamped({ has_trial: 1, trial_days: 14, trial_requires_card: null }),
      stamped({ has_trial: 1, trial_days: 14, trial_requires_card: 1 }),
    );
    expect(unknownCard).toHaveLength(0);
  });

  test("a batch predating trial detection never reads as 'trial removed'", () => {
    const changes = diffPricingBatches(
      stamped({ has_trial: null }),
      stamped({ has_trial: 0 }),
    );
    expect(changes).toHaveLength(0);
  });

  test("free plan disappearing is high", () => {
    const changes = diffPricingBatches(
      stamped({ has_free_plan: 1 }),
      stamped({ has_free_plan: 0 }),
    );
    expect(changes).toHaveLength(1);
    const c = changes[0]!;
    expect(c.type).toBe("free_plan_changed");
    expect(c.severity).toBe("high");
    expect(c.humanBefore).toBe("Free plan available");
    expect(c.humanAfter).toBe("No free plan");
  });
});

describe("ordering and helpers", () => {
  test("changes come back most severe first", () => {
    const changes = diffPricingBatches(
      [
        row({ plan_name: "Pro", price: 100 }),
        row({ plan_name: "Starter", price: 29 }),
      ],
      [
        row({ plan_name: "Pro", price: 101 }), // low
        row({ plan_name: "Starter", price: 25 }), // medium (-13.8%)
        row({ plan_name: "Scale", price: 199 }), // high (plan_added)
      ],
    );
    expect(changes.map((c) => c.severity)).toEqual(["high", "medium", "low"]);
  });

  test("maxPricingChangeSeverity picks the worst band", () => {
    const changes = diffPricingBatches(
      [row({ plan_name: "Pro", price: 100 })],
      [row({ plan_name: "Pro", price: 59 })],
    );
    expect(maxPricingChangeSeverity(changes)).toBe("critical");
    expect(maxPricingChangeSeverity([])).toBeNull();
  });

  test("formatPrice maps common codes and falls back to the code", () => {
    expect(formatPrice(79, "USD")).toBe("$79");
    expect(formatPrice(79.5, "EUR")).toBe("€79.5");
    expect(formatPrice(1299, "USD")).toBe("$1,299");
    expect(formatPrice(79, "CHF")).toBe("79 CHF");
    expect(formatPrice(79, null)).toBe("$79");
  });

  test("every summary line carries a price token (severity-guard shape)", () => {
    const changes = diffPricingBatches(
      [row({ plan_name: "Pro", price: 79 })],
      [row({ plan_name: "Pro", price: 59 })],
    );
    // The guard's PRICE_TOKEN regex: currency symbol + digit, or /mo-style suffix.
    expect(changes[0]!.summary).toMatch(/[€$£¥]\s?\d|\/\s?(mo|yr)\b/i);
  });
});
