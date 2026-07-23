import type { SourceType } from "@outrival/shared";

/**
 * The Product & Positioning feed reads one competitor through three lenses. They
 * are a filter over the SAME chronological list, not three queries: "All" is the
 * mixed feed exactly as it was, and the three counts always sum to it.
 */
export const PRODUCT_LENSES = ["narrative", "product", "social"] as const;
export type ProductLens = typeof PRODUCT_LENSES[number];

export const PRODUCT_LENS_LABELS: Record<ProductLens, string> = {
  narrative: "Narrative",
  product: "Product",
  social: "Social",
};

/**
 * Which lens each source belongs to. A source absent from this map is not part of
 * this tab — pricing, jobs and reviews have their own tabs, and tech stack has its
 * own card — so the lens counts partition the feed exactly.
 */
const LENS_OF: Partial<Record<SourceType, ProductLens>> = {
  // How they describe themselves and position against others.
  homepage: "narrative",
  blog: "narrative",
  // The sitemap branch anchors a new /vs/ or /alternatives/ page here — a
  // competitor naming you is positioning, not a product move.
  comparison_page: "narrative",
  // A page the user chose to watch on the competitor's own domain.
  custom: "narrative",
  // What they actually shipped, and what happened to the company.
  changelog: "product",
  news: "product",
  status: "product",
  // Mobile app association files / llms.txt appearing = a launch tell.
  wellknown: "product",
  // Where they're being talked about, and by whom.
  youtube: "social",
  hackernews: "social",
  github_repo: "social",
};

/** The lens a source belongs to, or null when it belongs to another tab. */
export function lensOf(sourceType: string): ProductLens | null {
  return LENS_OF[sourceType as SourceType] ?? null;
}

/** Every source this tab renders — used for its monitors + empty states. */
export const PRODUCT_SOURCES: readonly SourceType[] = Object.keys(LENS_OF) as SourceType[];

/** Count per lens, plus the total, over any list carrying a sourceType. */
export function lensCounts<T extends { sourceType: string }>(
  items: T[],
): Record<ProductLens | "all", number> {
  const counts = { narrative: 0, product: 0, social: 0, all: 0 };
  for (const item of items) {
    const lens = lensOf(item.sourceType);
    if (!lens) continue;
    counts[lens] += 1;
    counts.all += 1;
  }
  return counts;
}

/** The feed for a lens — `null` means "All", i.e. the untouched mixed feed. */
export function filterByLens<T extends { sourceType: string }>(
  items: T[],
  lens: ProductLens | null,
): T[] {
  return items.filter((item) => {
    const itemLens = lensOf(item.sourceType);
    if (!itemLens) return false;
    return lens === null || itemLens === lens;
  });
}
