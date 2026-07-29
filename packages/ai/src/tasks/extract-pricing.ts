import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

export const PricingPlanSchema = z.object({
  plan_name: z.string(),
  // null for quote-based tiers ("Contact sales"). A single such plan must not
  // discard the whole extraction, so the field is nullable, not required.
  price: z.number().nullable(),
  currency: z.string(),
  // "usage" = a per-`unit` rate (metered or outcome-based), not a per-time
  // subscription. See docs/pricing-coverage-2026.md.
  billing_period: z.enum(["monthly", "yearly", "one_time", "custom", "usage"]),
  // Dimensional pricing (2026 models). Optional/nullable so the structured-first
  // mapper and legacy AI outputs (which omit them) still validate against this schema.
  unit: z.string().nullable().optional(),
  included_quantity: z.number().nullable().optional(),
});

export const PricingSchema = z.object({
  plans: z.array(PricingPlanSchema),
});

export type PricingPlan = z.infer<typeof PricingPlanSchema>;
export type PricingExtraction = z.infer<typeof PricingSchema>;

// Currency symbol next to digits, either order — same shape the scraper's
// signal detector uses to flag a page "public".
const PRICE_TOKEN = /[€$£¥]\s?\d|\d[\d.,]*\s?[€$£¥]/;
const MAX_PRICING_TEXT = 12000;

/**
 * Pricing is often embedded low on a homepage (hero + features come first), past
 * a naive head slice — the scraper returns the whole homepage when prices live
 * in an on-page section. When the text overflows the window AND the first
 * visible price sits beyond it, recenter the window on the prices (with a lead-in
 * for the section heading + plan names) so the model actually sees the plans.
 * Falls back to the head when no price token is found (gated pages have none).
 */
function focusPricingText(text: string, max = MAX_PRICING_TEXT): string {
  if (text.length <= max) return text;
  const idx = text.search(PRICE_TOKEN);
  if (idx < 0 || idx < max) return text.slice(0, max);
  const start = Math.max(0, idx - 1500);
  return text.slice(start, start + max);
}

export async function extractPricing(pricingPageText: string): Promise<PricingExtraction | null> {
  const prompt = `<pricing_page>
${focusPricingText(pricingPageText)}
</pricing_page>

<task>
Extract the structured pricing plans from this pricing page. Write all text values in English.
- "plan_name": exact plan name (e.g. Free, Starter, Pro, Enterprise)
- "price": numeric amount (0 for free, strip the currency symbol). Use null for quote-based plans with no public price (e.g. "Contact sales", "Custom"). For a "usage" plan, this is the per-unit RATE (e.g. 0.10 for "$0.10 per API call").
- "currency": ISO code ("USD", "EUR", "GBP"...) — default to "USD" if ambiguous
- "billing_period" — the period the "price" COVERS, one of:
    - "monthly": the amount charged for ONE MONTH
    - "yearly": the amount charged for ONE YEAR — the annual TOTAL, never a per-month rate
    - "one_time": a one-off purchase or lifetime deal, and credit packs bought once
    - "custom": quote-based tier with no public price (Enterprise / "Contact sales")
    - "usage": a per-unit RATE, not a per-time subscription — metered usage ("$0.10 per API call", "per credit", "per GB") OR outcome-based pricing ("$0.99 per resolved ticket", "$2 per conversation")
- BILLING PERIOD vs COMMITMENT — the most common mistake on these pages. "billed annually",
  "billed yearly", "/mo billed annually", "per month, paid yearly" describe HOW the plan is
  invoiced; they do NOT make the amount next to them a yearly price. A figure written per
  month stays a MONTHLY price:
    - "$16/mo billed annually" → the yearly row is 16 x 12 = 192, NOT 16
    - "$39/month, paid for a year ($468/yr)" → monthly 39, yearly 468 (use the printed total when shown)
  A plan showing BOTH a month-to-month price and a discounted annual one → emit TWO entries with
  the SAME plan_name: the month-to-month figure as "monthly", and the ANNUAL TOTAL as "yearly".
  A "yearly" price is therefore always ~10-12x that plan's "monthly" price. Never emit a "yearly"
  price lower than, or equal to, the same plan's "monthly" price.
- "unit": for a "usage" price OR a per-seat price, WHAT the price applies to ("API call", "resolved conversation", "credit", "seat", "user", "GB", "transaction"). Use null for a flat price.
- "included_quantity": units bundled INTO the plan when stated — a credit pack's size (1000 for "$99 for 1000 credits"), or a tier's included calls (100 for "100 API calls included"). Use null when not stated.
- HYBRID plans (a subscription base PLUS a usage/overage rate) → emit TWO entries with the SAME plan_name: the base as "monthly"/"yearly", and the overage as "usage" with its unit.
- Keep quote-based tiers (price null). Ignore unrelated one-off add-ons and options.
- If no pricing can be found, return an empty "plans" array

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{
  "plans": [
    { "plan_name": "Pro", "price": 29, "currency": "USD", "billing_period": "monthly", "unit": null, "included_quantity": null },
    { "plan_name": "Pro", "price": 290, "currency": "USD", "billing_period": "yearly", "unit": null, "included_quantity": null },
    { "plan_name": "Team", "price": 15, "currency": "USD", "billing_period": "monthly", "unit": "seat", "included_quantity": null },
    { "plan_name": "Business", "price": 99, "currency": "USD", "billing_period": "monthly", "unit": null, "included_quantity": 10000 },
    { "plan_name": "Business", "price": 0.05, "currency": "USD", "billing_period": "usage", "unit": "API call", "included_quantity": null },
    { "plan_name": "Pay-as-you-go", "price": 0.10, "currency": "USD", "billing_period": "usage", "unit": "API call", "included_quantity": null },
    { "plan_name": "Credits", "price": 99, "currency": "USD", "billing_period": "one_time", "unit": "credit", "included_quantity": 1000 },
    { "plan_name": "Enterprise", "price": null, "currency": "USD", "billing_period": "custom", "unit": null, "included_quantity": null }
  ]
}
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 1536 });
  const result = safeParseJson(raw, PricingSchema);
  if (!result.ok) {
    console.error("Pricing extraction parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
