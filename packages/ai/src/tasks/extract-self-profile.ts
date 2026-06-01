import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

export const SelfProfileExtractionSchema = z.object({
  // Concrete product capabilities advertised on the site (not marketing fluff).
  features: z.array(z.string()),
  // Technologies the product is built on / integrates with, when detectable.
  techStack: z.array(z.string()),
});

export type SelfProfileExtraction = z.infer<typeof SelfProfileExtractionSchema>;

/**
 * Extract the structured part of a product's profile that has no other source:
 * its feature list and detectable tech stack. Used only for the self-competitor
 * (the user's own product) — category/audience/valueProp already come from the
 * onboarding profile. 70b model for richer extraction, mirroring analyzeProduct.
 */
export async function extractSelfProfile(
  homepageText: string,
): Promise<SelfProfileExtraction | null> {
  const prompt = `<homepage>
${homepageText.slice(0, 6000)}
</homepage>

<task>
This is a product/SaaS website. Extract two lists:
1. "features" — the concrete capabilities the product offers (what it actually
   does), as short noun phrases. Skip taglines and generic marketing claims.
2. "techStack" — technologies the product is clearly built on or integrates with
   (frameworks, languages, databases, key integrations) when they are stated or
   strongly implied. Leave empty if nothing is detectable — do not guess.
Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write all text values in English. Cap each list at 12 items.
</task>

<format>
{
  "features": ["e.g. Automatic competitor discovery", "e.g. Real-time alerts"],
  "techStack": ["e.g. Next.js", "e.g. Stripe"]
}
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true });
  const result = safeParseJson(raw, SelfProfileExtractionSchema);
  if (!result.ok) {
    console.error("Self profile extraction parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
