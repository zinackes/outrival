import { z } from "zod";
import { RATE_STRUCTURES } from "@outrival/shared";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

/**
 * One published volume band of a metered plan (Pricing Intelligence P3). Only
 * ever emitted when the page prints the ladder; the set is validated in code
 * before anything is stored, and an invalid set is dropped whole — see
 * validateTierSet in @outrival/shared.
 */
export const PricingTierSchema = z.object({
  from_qty: z.number(),
  /** null = the last, unbounded band. */
  to_qty: z.number().nullable().optional(),
  unit_price: z.number().nullable().optional(),
  flat_fee: z.number().nullable().optional(),
});

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
  // Rate structures (Pricing Intelligence P3). All optional/nullable: the
  // structured-first mapper, the harvest floor and every legacy AI output omit
  // them, and their absence is not a fact about the plan.
  rate_structure: z.enum(RATE_STRUCTURES).nullable().optional(),
  minimum_amount: z.number().nullable().optional(),
  percentage_rate: z.number().nullable().optional(),
  tiers: z.array(PricingTierSchema).nullable().optional(),
  /** Worked examples the page itself prints ("~$25 for 1M requests"). Stored as
   * price_points with method='published' — a figure the competitor published,
   * which is a different claim from one we derived, and grounded in code
   * against the page text before it is believed. */
  cost_examples: z
    .array(z.object({ qty: z.number(), cost: z.number() }))
    .nullable()
    .optional(),
});

/**
 * What one action SPENDS from a credit balance (Pricing Intelligence P5).
 * Emitted ONLY when the page publishes the mapping itself; `action` must be the
 * page's own wording, because the worker checks it back against the page text
 * before storing anything — an action nobody wrote down is dropped in code.
 */
export const CreditBurnSchema = z.object({
  action: z.string(),
  credits: z.number(),
});

export const PricingSchema = z.object({
  plans: z.array(PricingPlanSchema),
  // Page-level, like the trial/free-plan facts: a credits product publishes ONE
  // burn table for the whole product, not one per plan. Optional so every other
  // stage (structured-first, cached parser, harvest floor) validates unchanged.
  credit_burns: z.array(CreditBurnSchema).nullable().optional(),
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
- "rate_structure": HOW a metered plan charges, ONLY when the page states it. Use null for a plain subscription.
    - "graduated": each volume band's own rate applies to the units inside it ("first 10,000 at $0.10, next 40,000 at $0.08")
    - "volume": the reached band's rate applies to ALL units ("10,000+ requests: $0.08 each, on everything")
    - "package": priced in blocks ("$5 per 1,000 emails") — put the block price in "price" and the block size in "included_quantity"
    - "percentage": a share of the transacted amount ("2.9% + $0.30 per transaction")
    - "standard": one flat per-unit rate with no bands
- "minimum_amount": a monthly floor the plan bills before any usage ("$50/month minimum", "minimum spend $500"). This is a floor, NOT a base fee added on top. Use null when the page states none.
- "percentage_rate": for a "percentage" plan, the percent as a NUMBER (2.9 for "2.9%"), and "price" then carries the FIXED part ($0.30 for "2.9% + $0.30").
- "tiers": the published volume bands, ONLY when the page actually prints them (a tier table, or "First 10,000 free, then $0.10"). Each band: "from_qty" (the quantity it starts at), "to_qty" (the last quantity it covers, null for the final unbounded band), "unit_price" (per unit inside the band), "flat_fee" (a one-off charge for entering the band, null when there is none).
    - NEVER invent bands, never interpolate a ladder from a single rate, never derive bands from a calculator or a slider. A page with one rate and no table has NO tiers.
    - Bands must be ordered and must not overlap. Copy the numbers the page prints.
    - A free allowance IS a band: "first 10,000 free, then $0.10" → [{from_qty: 0, to_qty: 10000, unit_price: 0}, {from_qty: 10000, to_qty: null, unit_price: 0.10}]
- "cost_examples": worked totals the page PRINTS for a stated volume ("about $25 for 1M requests", "10,000 contacts = $99/mo") → [{qty, cost}]. Copy both numbers verbatim from the page. Never compute one yourself, and never restate a per-unit rate as an example. Omit when the page prints none.
- "credit_burns": for a product that sells CREDITS, what each action SPENDS from the balance, ONLY when the page publishes that mapping itself (a "1 credit = 1 scan" line, an actions x credits table, "each export costs 2 credits") → [{action, credits}].
    - "action" must be the page's OWN wording for the action ("OCR page", "Deep scan", "Video export"). Copy it, do not paraphrase or translate it.
    - "credits" is how many credits ONE of that action costs, as a number.
    - NEVER infer a mapping from a pack price, a plan allowance, or a rate. If the page only says "1,000 credits for $99" and never says what a credit buys, there are NO credit_burns.
    - Omit the field entirely when the page publishes no such mapping.
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
    { "plan_name": "Scale", "price": 0.10, "currency": "USD", "billing_period": "usage", "unit": "API call", "rate_structure": "graduated", "minimum_amount": 50, "tiers": [
      { "from_qty": 0, "to_qty": 10000, "unit_price": 0.10, "flat_fee": null },
      { "from_qty": 10000, "to_qty": 50000, "unit_price": 0.08, "flat_fee": null },
      { "from_qty": 50000, "to_qty": null, "unit_price": 0.05, "flat_fee": null }
    ] },
    { "plan_name": "Bulk email", "price": 5, "currency": "USD", "billing_period": "usage", "unit": "email", "included_quantity": 1000, "rate_structure": "package" },
    { "plan_name": "Payments", "price": 0.30, "currency": "USD", "billing_period": "usage", "unit": "transaction", "rate_structure": "percentage", "percentage_rate": 2.9 },
    { "plan_name": "Enterprise", "price": null, "currency": "USD", "billing_period": "custom", "unit": null, "included_quantity": null }
  ],
  "credit_burns": [
    { "action": "OCR page", "credits": 5 },
    { "action": "Deep scan", "credits": 1 }
  ]
}
</format>`;

  // 2048, not 1536: a page that publishes a ladder emits a tiers array per
  // metered plan, and a response truncated mid-array parses as nothing at all.
  const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 2048 });
  const result = safeParseJson(raw, PricingSchema);
  if (!result.ok) {
    console.error("Pricing extraction parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
