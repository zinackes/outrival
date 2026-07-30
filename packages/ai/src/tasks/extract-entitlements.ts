import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

// Pricing Intelligence P2 — the AI sister of extract-pricing, called by the
// SAME worker run only when the deterministic <table> parser found no
// comparison matrix (cards + bullet lists, custom grids). One extra AI call per
// CHANGED pricing scrape, nothing on the unchanged path. The worker applies the
// deterministic anti-hallucination substring check on feature_label afterwards
// (posting_facts pattern) — a label absent from the page text is dropped in
// code, so the prompt rule is not the only guard.

export const ExtractedEntitlementSchema = z.object({
  plan_name: z.string(),
  feature_label: z.string(),
  kind: z.enum(["boolean", "config", "metered"]),
  value_num: z.number().nullable().optional(),
  value_text: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  reset_period: z.string().nullable().optional(),
});

export const EntitlementsSchema = z.object({
  entitlements: z.array(ExtractedEntitlementSchema),
});

export type ExtractedEntitlement = z.infer<typeof ExtractedEntitlementSchema>;
export type EntitlementsExtraction = z.infer<typeof EntitlementsSchema>;

const MAX_ENTITLEMENT_TEXT = 14000;

export async function extractEntitlements(
  pricingPageText: string,
  planNames: string[],
): Promise<EntitlementsExtraction | null> {
  const prompt = `<pricing_page>
${pricingPageText.slice(0, MAX_ENTITLEMENT_TEXT)}
</pricing_page>

<known_plans>
${planNames.join(" · ")}
</known_plans>

<task>
Extract the features-per-plan matrix (entitlements) from this pricing page: for each plan, which features it includes and at what limit.
- "plan_name": one of the known plans above, exactly as written there
- "feature_label": the feature's EXACT wording as it appears on the page — copy it VERBATIM, never translate, rephrase or summarize it
- "kind":
    - "boolean": the feature is simply on/off for the plan (a checkmark, a bullet)
    - "config": a fixed non-numeric value ("Priority", "24/7", "Unlimited" → value_text)
    - "metered": a numeric limit ("5 users", "10,000 API calls/mo" → value_num, unit, reset_period)
- "value_num": the numeric limit for "metered" (5 for "5 users"); null otherwise
- "value_text": the fixed value for "config" ("Priority", "Unlimited"); null otherwise
- "unit": what value_num counts ("users", "API calls", "GB"); null otherwise
- "reset_period": when a metered limit resets, if stated ("per month"); null otherwise
- Only list features the page EXPLICITLY shows for that plan. "Everything in Pro, plus X, Y" lists ONLY X and Y for that plan — never expand the inherited set.
- A page with no visible features-per-plan breakdown (prices only, no feature lists) → return an empty "entitlements" array. Never invent a feature.
- Keep the 15 most differentiating features when the page lists more (security, seats, limits, support first; skip marketing fluff like "Beautiful UI").

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{
  "entitlements": [
    { "plan_name": "Starter", "feature_label": "Up to 5 users", "kind": "metered", "value_num": 5, "value_text": null, "unit": "users", "reset_period": null },
    { "plan_name": "Pro", "feature_label": "Single sign-on (SSO)", "kind": "boolean", "value_num": null, "value_text": null, "unit": null, "reset_period": null },
    { "plan_name": "Pro", "feature_label": "10,000 API calls", "kind": "metered", "value_num": 10000, "value_text": null, "unit": "API calls", "reset_period": "per month" },
    { "plan_name": "Enterprise", "feature_label": "Priority support", "kind": "config", "value_num": null, "value_text": "Priority", "unit": null, "reset_period": null }
  ]
}
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 2048 });
  const result = safeParseJson(raw, EntitlementsSchema);
  if (!result.ok) {
    console.error("Entitlement extraction parse failed:", result.error, "raw:", raw.slice(0, 300));
    return null;
  }
  return result.value;
}
