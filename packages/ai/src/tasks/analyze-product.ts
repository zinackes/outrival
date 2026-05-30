import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

export const ProductProfileSchema = z.object({
  category: z.string(),
  audience: z.string(),
  valueProp: z.string(),
  pricingModel: z.string(),
});

export type ProductProfile = z.infer<typeof ProductProfileSchema>;

/**
 * Semantic query describing what the product *does* — fed to Exa's company
 * search to find competitors (same function, different name), not look-alike
 * pages. Built from category + audience, the axis that defines a competitive set.
 * `keywords` (user-configured) are appended to bias the search further.
 */
export function buildDiscoveryQuery(
  profile: ProductProfile,
  keywords?: string,
): string {
  const core = [profile.category, profile.audience]
    .map((s) => s.trim())
    .filter(Boolean);
  let base: string;
  if (core.length === 2) base = `${core[0]} for ${core[1]}`;
  else if (core.length === 1) base = core[0]!;
  else base = profile.valueProp.trim();

  const extra = keywords?.trim();
  return extra ? `${base} ${extra}` : base;
}

export async function analyzeProduct(homepageText: string): Promise<ProductProfile | null> {
  const prompt = `<homepage>
${homepageText.slice(0, 4000)}
</homepage>

<task>
Analyse ce site de produit/SaaS et déduis son profil.
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
    console.error("Product analysis parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
