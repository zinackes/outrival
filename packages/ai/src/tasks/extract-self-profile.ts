import { z } from "zod";
import { AI_CONFIG } from "../config";
import { groundedAiCall } from "../grounding/grounded-call";
import { attachQuality, type WithQuality } from "../grounding/types";

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
): Promise<WithQuality<SelfProfileExtraction> | null> {
  const prompt = `<homepage>
${homepageText.slice(0, 6000)}
</homepage>

<task>
Profile the product behind this page. Be specific and grounded in what the page
actually says — never fall back to a generic label. Extract:
1. "category" — the specific FUNCTIONAL category, defined by what the product
   does, not its business model or delivery format. Do NOT answer "B2B SaaS",
   "mobile app" or "platform". Good answers span every kind of business, e.g.
   "competitive-intelligence software", "appointment-scheduling tool",
   "freelance marketplace for designers", "meal-kit delivery service".
2. "audience" — who specifically uses or buys it (role plus context), one phrase.
3. "valueProp" — ONE sentence naming the concrete job it does and the outcome.
   Ban filler ("streamline your workflow", "all-in-one"); say what it changes.
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
  "category": "<specific functional category>",
  "audience": "<who specifically uses it>",
  "valueProp": "<one concrete sentence>",
  "features": ["<concrete capability>", "<concrete capability>"],
  "techStack": ["<technology>", "<technology>"]
}
</format>`;

  const result = await groundedAiCall({
    taskName: "extract_features",
    config: AI_CONFIG.classification,
    prompt,
    sourceText: homepageText.slice(0, 6000),
    schema: SelfProfileExtractionSchema,
  });
  return result ? attachQuality(result.output, result.quality) : null;
}
