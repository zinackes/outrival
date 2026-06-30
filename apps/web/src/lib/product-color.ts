import { COMPETITOR_COLORS } from "@outrival/shared";
import { competitorColorVars, type CompetitorColorVars } from "./competitor-color";

// Product color identity (Option A — no products.color column yet). Products are a
// thin 1:1 wrapper over a self-competitor, so rather than store a color we derive a
// stable, distinct token from the product's display `position` — every product gets
// its own palette color out of the box, scannable for grouping. `override` is the
// thread for a future per-product (or self-competitor) color without touching callers.
export function productColorToken(
  position: number,
  override?: string | null,
): string {
  if (override) return override;
  const n = COMPETITOR_COLORS.length;
  const i = ((position % n) + n) % n; // wrap negatives, stay in range
  return COMPETITOR_COLORS[i]!.token;
}

// Inline CSS vars (--comp-h/--comp-c) for a product's color, to combine with the
// COMP_* expressions from competitor-color.ts (the per-theme lightness comes from the
// theme). Always resolves to a known palette token, so it never returns null.
export function productColorVars(
  position: number,
  override?: string | null,
): CompetitorColorVars {
  return competitorColorVars(productColorToken(position, override)) ?? {};
}
