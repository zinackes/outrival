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
  billing_period: z.enum(["monthly", "yearly", "one_time", "custom"]),
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
Extract the structured pricing plans from this pricing page.
- "plan_name": exact plan name (e.g. Free, Starter, Pro, Enterprise)
- "price": numeric amount (0 for free, strip the currency symbol). Use null for quote-based plans with no public price (e.g. "Contact sales", "Custom").
- "currency": ISO code ("USD", "EUR", "GBP"...) — default to "USD" if ambiguous
- "billing_period": "monthly" | "yearly" | "one_time" | "custom" (Enterprise quote-based => "custom")
- Ignore add-ons and options; keep only the main plans
- If no price can be found, return an empty "plans" array

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{
  "plans": [
    { "plan_name": "Pro", "price": 29, "currency": "USD", "billing_period": "monthly" },
    { "plan_name": "Enterprise", "price": null, "currency": "USD", "billing_period": "custom" }
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
