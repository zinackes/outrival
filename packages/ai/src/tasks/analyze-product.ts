import { z } from "zod";
import { AI_CONFIG } from "../config";
import { groundedAiCall } from "../grounding/grounded-call";
import { attachQuality, type WithQuality } from "../grounding/types";

const CACHE_TTL_SECONDS = Number(process.env.AI_CACHE_TTL_ANALYZE_DAYS ?? 30) * 86400;

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

export async function analyzeProduct(
  homepageText: string,
): Promise<WithQuality<ProductProfile> | null> {
  const prompt = `<homepage>
${homepageText.slice(0, 4000)}
</homepage>

<task>
Analyze this product/SaaS website and infer its profile.
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

  // Keep the 70b model here — product profiling needs richer reasoning.
  const result = await groundedAiCall({
    taskName: "analyze_product",
    config: AI_CONFIG.classification,
    prompt,
    sourceText: homepageText.slice(0, 4000),
    schema: ProductProfileSchema,
    cache: { input: homepageText, namespace: "analyze", ttlSeconds: CACHE_TTL_SECONDS },
  });
  return result ? attachQuality(result.output, result.quality) : null;
}
