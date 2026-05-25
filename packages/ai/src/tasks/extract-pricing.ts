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
Extrais les plans tarifaires structurés de cette page pricing.
- "plan_name" : nom exact du plan (ex: Free, Starter, Pro, Enterprise)
- "price" : montant numérique (0 pour gratuit, retire la devise)
- "currency" : code ISO ("USD", "EUR", "GBP"...) — par défaut "USD" si ambigu
- "billing_period" : "monthly" | "yearly" | "one_time" | "custom" (Enterprise sur devis => "custom")
- Ignore les add-ons et les options ; ne garde que les plans principaux
- Si aucun prix n'est trouvable, renvoie un tableau "plans" vide

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni texte autour.
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
