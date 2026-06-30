import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";
import { ProductProfileSchema, type ProductProfile } from "../tasks/analyze-product";
import { buildProfilePrompt } from "./profile-prompt";

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

  const sourceBlock = `<description>
${input.description.slice(0, 4000)}
</description>${category ? `\n<category_hint>${category}</category_hint>` : ""}${
    inspirations.length ? `\n<inspirations>${inspirations.join(", ")}</inspirations>` : ""
  }`;
  const prompt = buildProfilePrompt(
    sourceBlock,
    "Profile the product behind this idea. Describe THIS product specifically. If a category hint is given, use it only to disambiguate — still name the precise functional category, not the hint verbatim. If inspirations are cited, place the product in the same competitive space without copying them.",
  );

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
