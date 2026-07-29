/**
 * Monthly↔yearly ratio sanity check (patch-32). A `yearly` price is the amount
 * charged for a YEAR (see ./normalize-periods for the canon), so against the same
 * plan's monthly price it must land at ~10–12× — an annual total, often with 1–2
 * months free. Anything else is an extraction error: a /mo figure read as /yr, the
 * same number scraped for both periods, or a mangled amount.
 *
 * This check runs on RECONCILED plans (`reconcileBillingPeriods` first), which is
 * what makes it strict: the "yearly ≤ monthly" band this used to tolerate was the
 * discounted per-month rate behind a "billed yearly" toggle, and tolerating it is
 * precisely what let `$16/mo billed annually` reach the database as `$16/year`.
 * The reconciler turns that into $192/year before we get here, so a yearly that is
 * still ≤ monthly is now a genuine defect and must fail.
 *
 * Used as part of the staged-extraction `plausible` gate for pricing: when a
 * structured-first or cached-parser result fails this check it is treated as a
 * mis-parse and the pipeline falls through to the AI floor. Pure, AI-free.
 */

export interface PricingRatioPlan {
  plan_name: string;
  price: number | null;
  billing_period: string;
}

// A yearly total normally lands at 10–12× monthly; allow slack on both sides.
const ANNUAL_MIN = 9;
const ANNUAL_MAX = 13;

/**
 * True unless a plan exposes both a monthly and a yearly price whose ratio is
 * implausible. No comparable pair (single-period page, distinct plan names) → true:
 * we never over-filter what we can't disprove, mirroring the project's bias toward
 * not dropping real signal.
 */
export function pricingRatiosPlausible(plans: PricingRatioPlan[]): boolean {
  const byName = new Map<string, { monthly?: number; yearly?: number }>();
  for (const p of plans) {
    if (p.price == null || p.price <= 0) continue;
    const key = p.plan_name.trim().toLowerCase();
    const slot = byName.get(key) ?? {};
    if (p.billing_period === "monthly") slot.monthly = p.price;
    else if (p.billing_period === "yearly") slot.yearly = p.price;
    byName.set(key, slot);
  }
  for (const { monthly, yearly } of byName.values()) {
    if (monthly == null || yearly == null) continue;
    const ratio = yearly / monthly;
    if (ratio > ANNUAL_MAX || ratio < ANNUAL_MIN) return false;
  }
  return true;
}
