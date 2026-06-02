import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

export const SelfProfileExtractionSchema = z.object({
  // One short phrase for the kind of product this is (e.g. "Competitive intelligence
  // SaaS"). Empty string when unclear — never guessed.
  category: z.string(),
  // Who the product is for (target audience / segments), one short phrase.
  audience: z.string(),
  // The core value proposition in one sentence.
  valueProp: z.string(),
  // Concrete product capabilities advertised on the site (not marketing fluff).
  features: z.array(z.string()),
  // Technologies the product is built on / integrates with, when detectable.
  techStack: z.array(z.string()),
});

export type SelfProfileExtraction = z.infer<typeof SelfProfileExtractionSchema>;

/**
 * Extract the self-competitor's profile from its homepage: category, audience and
 * value proposition (refreshed on each scrape so a re-scan keeps them current), plus
 * its feature list and detectable tech stack (which have no other source). Used only
 * for the self-competitor (the user's own product). Auto-detected fields stay sticky
 * against fields the user edited by hand. 70b model, mirroring analyzeProduct.
 */
export async function extractSelfProfile(
  homepageText: string,
): Promise<SelfProfileExtraction | null> {
  const prompt = `<homepage>
${homepageText.slice(0, 6000)}
</homepage>

<task>
This is a product/SaaS website. Extract:
1. "category" — what kind of product this is, one short phrase.
2. "audience" — who it is for (target users / segments), one short phrase.
3. "valueProp" — the core value proposition in one sentence.
4. "features" — the concrete capabilities the product offers (what it actually
   does), as short noun phrases. Skip taglines and generic marketing claims.
5. "techStack" — technologies the product is clearly built on or integrates with
   (frameworks, languages, databases, key integrations) when they are stated or
   strongly implied. Leave empty if nothing is detectable — do not guess.
For any text field you cannot determine, return an empty string — never guess.
Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write all text values in English. Cap each list at 12 items.
</task>

<format>
{
  "category": "e.g. Competitive intelligence SaaS",
  "audience": "e.g. Product and marketing teams at B2B SaaS companies",
  "valueProp": "e.g. Automatically track competitors and turn changes into insights",
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
