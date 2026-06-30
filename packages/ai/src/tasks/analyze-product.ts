import { z } from "zod";
import { AI_CONFIG } from "../config";
import { groundedAiCall } from "../grounding/grounded-call";
import { attachQuality, type WithQuality } from "../grounding/types";
import { buildProfilePrompt } from "../profile/profile-prompt";

const CACHE_TTL_SECONDS = Number(process.env.AI_CACHE_TTL_ANALYZE_DAYS ?? 30) * 86400;

export const ProductProfileSchema = z.object({
  category: z.string(),
  audience: z.string(),
  valueProp: z.string(),
  pricingModel: z.string(),
  // Concrete, grounded description of what the product actually does + functional
  // search keywords. Both feed competitor discovery (a richer Exa query + sharper
  // overlap scoring). Optional so profiles stored before this change still parse.
  whatItDoes: z.string().optional(),
  keywords: z.array(z.string()).optional(),
});

export type ProductProfile = z.infer<typeof ProductProfileSchema>;

/**
 * Semantic query describing what the product *does* — fed to Exa's company
 * search to find competitors (same function, different name), not look-alike
 * pages. Exa's own guidance is to "describe the ideal page to a colleague", so we
 * build a descriptive phrase (functional category — what it does — for whom) and
 * append concrete keywords, rather than a generic "<category> for <audience>"
 * (which returned random companies sharing only a business model). `keywords`
 * (user-configured, comma/newline-separated) are merged with the profile's own.
 */
export function buildDiscoveryQuery(
  profile: ProductProfile,
  keywords?: string,
): string {
  const category = profile.category?.trim() ?? "";
  const whatItDoes = profile.whatItDoes?.trim() ?? "";
  const valueProp = profile.valueProp?.trim() ?? "";
  const audience = profile.audience?.trim() ?? "";
  const what = whatItDoes || valueProp;

  const segments: string[] = [];
  if (category) segments.push(category);
  if (what && what.toLowerCase() !== category.toLowerCase()) segments.push(what);
  let base = segments.join(" — ");
  if (audience) base = base ? `${base} for ${audience}` : audience;
  if (!base) base = valueProp;

  const merged = [
    ...(profile.keywords ?? []),
    ...(keywords ? keywords.split(/[,\n]/) : []),
  ].map((k) => k.trim());
  const seen = new Set<string>();
  const uniqueKeywords = merged
    .filter((k) => {
      if (!k) return false;
      const key = k.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);

  return uniqueKeywords.length ? `${base} (${uniqueKeywords.join(", ")})` : base;
}

// Structural shape of a self-competitor's `selfProfile` (packages/db competitors),
// typed locally so @outrival/ai stays free of a @outrival/db dependency.
export interface SelfProfileLike {
  category?: { value?: string | null } | null;
  audience?: { value?: string | null } | null;
  valueProp?: { value?: string | null } | null;
  features?: { value?: string[] | null } | null;
}

/**
 * patch-28 multi-SKU discovery — derive a flat ProductProfile (the discovery input)
 * from a product's self-competitor `selfProfile` (the per-product, auto-refreshed
 * source of truth). `fallback` is the org's legacy `productProfile`, used only for
 * the primary product where the self-profile may be sparse. Returns null when there
 * is nothing to search on (no category and no value prop), so callers can skip the
 * Exa spend entirely.
 */
export function selfProfileToDiscoveryProfile(
  sp: SelfProfileLike | null | undefined,
  fallback?: ProductProfile | null,
): ProductProfile | null {
  const category = sp?.category?.value?.trim() || fallback?.category?.trim() || "";
  const audience = sp?.audience?.value?.trim() || fallback?.audience?.trim() || "";
  const valueProp = sp?.valueProp?.value?.trim() || fallback?.valueProp?.trim() || "";
  if (!category && !valueProp) return null;
  const keywords = sp?.features?.value?.length ? sp.features.value : fallback?.keywords;
  return {
    category,
    audience,
    valueProp,
    pricingModel: fallback?.pricingModel ?? "",
    whatItDoes: valueProp || fallback?.whatItDoes,
    keywords,
  };
}

export async function analyzeProduct(
  homepageText: string,
): Promise<WithQuality<ProductProfile> | null> {
  const source = homepageText.slice(0, 6000);
  const prompt = buildProfilePrompt(
    `<homepage>\n${source}\n</homepage>`,
    "Profile the product or company behind this homepage. Base every field on what this page actually says — be specific, never generic.",
  );

  // Keep the 70b model here — product profiling needs richer reasoning.
  const result = await groundedAiCall({
    taskName: "analyze_product",
    config: AI_CONFIG.classification,
    prompt,
    sourceText: source,
    schema: ProductProfileSchema,
    cache: { input: homepageText, namespace: "analyze", ttlSeconds: CACHE_TTL_SECONDS },
  });
  return result ? attachQuality(result.output, result.quality) : null;
}
