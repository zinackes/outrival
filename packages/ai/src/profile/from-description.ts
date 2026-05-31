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
À partir de cette idée de produit/SaaS, déduis son profil produit.
Si une catégorie est donnée, respecte-la. Si des inspirations sont citées,
ancre le ton et le positionnement dans le même espace concurrentiel sans les copier.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni texte autour.
</task>

<format>
{
  "category": "ex: SaaS B2B / Productivité",
  "audience": "ex: Startups 1-50 personnes",
  "valueProp": "ex: Automatisation de X en une phrase",
  "pricingModel": "ex: Freemium + abonnement"
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
