import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";
import { ProductProfileSchema, type ProductProfile } from "../tasks/analyze-product";

export interface FromDescriptionInput {
  description: string;
  /** Optional category tag picked by the user (B2B SaaS, DevTools, …). */
  category?: string;
  /** 0-3 product names or URLs the user is inspired by — anchors the tone. */
  inspirations?: string[];
}

/**
 * "Idea" stage adapter: turn a free-text description (+ optional category and
 * inspirations) into a ProductProfile. Same Groq + JSON pattern as analyzeProduct.
 */
export async function fromDescription(
  input: FromDescriptionInput,
): Promise<ProductProfile | null> {
  const category = input.category?.trim();
  const inspirations = (input.inspirations ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);

  const prompt = `<description>
${input.description.slice(0, 4000)}
</description>
${category ? `\n<category>${category}</category>` : ""}
${inspirations.length ? `\n<inspirations>${inspirations.join(", ")}</inspirations>` : ""}

<task>
From this product/SaaS idea, infer its product profile.
If a category is given, respect it. If inspirations are cited,
anchor the tone and positioning in the same competitive space without copying them.
Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write all text values in English.
</task>

<format>
{
  "category": "e.g. B2B SaaS / Productivity",
  "audience": "e.g. Startups of 1-50 people",
  "valueProp": "e.g. Automating X, in one sentence",
  "pricingModel": "e.g. Freemium + subscription"
}
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true });
  const result = safeParseJson(raw, ProductProfileSchema);
  if (!result.ok) {
    console.error(
      "fromDescription parse failed:",
      result.error,
      "raw:",
      raw.slice(0, 500),
    );
    return null;
  }
  return result.value;
}
