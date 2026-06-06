/**
 * Monthly↔yearly ratio sanity check (patch-32). A yearly price is legitimately
 * EITHER ~10–12× the monthly one (an annual total, often with 1–2 months free)
 * OR ≤ the monthly one (sites that show the discounted per-month rate behind a
 * "billed yearly" toggle). A yearly that sits between those bands — or one absurdly
 * larger than ~12× — is almost always an extraction error (a /mo read as /yr, or
 * the same number scraped for both periods).
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
// Yearly shown as a discounted per-month rate is ≤ the monthly rate.
const DISCOUNT_MAX = 1.05;

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
    if (ratio > ANNUAL_MAX) return false;
    if (ratio > DISCOUNT_MAX && ratio < ANNUAL_MIN) return false;
  }
  return true;
}
