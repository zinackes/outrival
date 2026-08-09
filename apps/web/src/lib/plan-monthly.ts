import { monthlyEquivalent, normalizePlanKey } from "@outrival/shared";
import { convertCurrency } from "./fx";

/** The snake_case pricing row every captured tier list already carries. */
export interface PlanPriceRow {
  plan_name: string;
  price: number | null;
  currency: string;
  billing_period: string;
}

/**
 * plan key → monthly price in one display currency, the map the entitlement
 * comparison joins its rows against (`normalizePlanKey` on both sides).
 *
 * A plan we cannot express as a monthly number — quote-based, one-off, a usage
 * rate, a currency today's rates cannot convert — maps to null rather than to a
 * face value. The comparison reads null as quote-based and declines the delta,
 * which is the honest answer: a yearly total and a monthly fee are not the same
 * number, and neither are two currencies.
 */
export function planMonthlyMap(
  tiers: readonly PlanPriceRow[],
  displayCurrency: string,
  rates: Record<string, number> | null,
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const tier of tiers) {
    const key = normalizePlanKey(tier.plan_name);
    const monthly =
      tier.price == null
        ? null
        : monthlyEquivalent({
            planName: tier.plan_name,
            price: tier.price,
            currency: tier.currency,
            billingPeriod: tier.billing_period,
          });
    const converted =
      monthly == null
        ? null
        : tier.currency === displayCurrency
          ? monthly
          : convertCurrency(monthly, tier.currency, displayCurrency, rates);
    if (converted == null) {
      if (!out.has(key)) out.set(key, null);
      continue;
    }
    // Cheapest wins: a plan captured on both billing periods enters the
    // comparison at the lower monthly equivalent, not at whichever row came first.
    const previous = out.get(key);
    out.set(key, previous == null ? converted : Math.min(previous, converted));
  }
  return out;
}
