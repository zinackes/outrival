import { analyzeProduct, type ProductProfile } from "../tasks/analyze-product";

/**
 * "Live" stage adapter. Thin typed wrapper over the existing analyzeProduct flow so
 * the four onboarding modes share one surface. Fetching (quickFetchText) stays in the
 * API layer — packages/ai is pure and only sees already-extracted homepage text.
 */
export async function fromUrl(
  homepageText: string,
): Promise<ProductProfile | null> {
  return analyzeProduct(homepageText);
}
