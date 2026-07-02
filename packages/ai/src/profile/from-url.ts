import { analyzeProduct, type ProductProfile } from "../tasks/analyze-product";

/**
 * "Live" stage adapter. Thin typed wrapper over the existing analyzeProduct flow so
 * the four onboarding modes share one surface. Fetching (quickFetch) stays in the
 * API layer — packages/ai is pure and only sees already-extracted text. When the API
 * resolved a dedicated pricing page it passes its text so pricingModel is grounded.
 */
export async function fromUrl(
  homepageText: string,
  pricingText?: string,
): Promise<ProductProfile | null> {
  return analyzeProduct(homepageText, pricingText);
}
