import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

export const PricingPlanSchema = z.object({
  plan_name: z.string(),
  price: z.number(),
  currency: z.string(),
  billing_period: z.enum(["monthly", "yearly", "one_time", "custom"]),
});

export const PricingSchema = z.object({
  plans: z.array(PricingPlanSchema),
});

export type PricingPlan = z.infer<typeof PricingPlanSchema>;
export type PricingExtraction = z.infer<typeof PricingSchema>;

export async function extractPricing(pricingPageText: string): Promise<PricingExtraction | null> {
  const prompt = `<pricing_page>
${pricingPageText.slice(0, 8000)}
</pricing_page>

<task>
Extract the structured pricing plans from this pricing page.
- "plan_name": exact plan name (e.g. Free, Starter, Pro, Enterprise)
- "price": numeric amount (0 for free, strip the currency symbol)
- "currency": ISO code ("USD", "EUR", "GBP"...) — default to "USD" if ambiguous
- "billing_period": "monthly" | "yearly" | "one_time" | "custom" (Enterprise quote-based => "custom")
- Ignore add-ons and options; keep only the main plans
- If no price can be found, return an empty "plans" array

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{
  "plans": [
    { "plan_name": "Pro", "price": 29, "currency": "USD", "billing_period": "monthly" }
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
