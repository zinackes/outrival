"use client";

import { COMP_ACCENT } from "@/lib/competitor-color";
import { productColorVars } from "@/lib/product-color";
import { CompAvatar } from "./comp-avatar";
import { cn } from "@/lib/utils";

/**
 * A product's identity mark: its site's favicon, ringed in the product's color.
 *
 * The favicon comes from the same <CompAvatar> competitors use, through the same
 * same-origin proxy, so a product reads like the things it is compared against
 * rather than like a settings row. A product with no site falls back to its repo
 * host (GitHub's mark, which is the honest picture of a product still being
 * built), then to its initial.
 *
 * The ring carries the SKU because the favicon cannot: two products of one
 * company usually share a domain, so outrival.app and developers.outrival.app
 * would be indistinguishable without it. Mono-product orgs never see a second
 * product to disambiguate against, so `ring` is opt-in.
 */
export function ProductTile({
  name,
  url,
  repoUrl,
  position,
  size = 28,
  ring = false,
  className,
}: {
  name: string;
  url?: string | null;
  repoUrl?: string | null;
  /** Display position, which is what the color token is derived from. */
  position?: number;
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  const vars = ring && position !== undefined ? productColorVars(position) : null;
  return (
    <span
      className={cn("relative inline-flex shrink-0 rounded-[5px]", className)}
      // An outer ring, not a fill: the favicon keeps the tile, the color only
      // outlines it.
      style={vars ? { ...vars, boxShadow: `0 0 0 1.5px ${COMP_ACCENT}` } : undefined}
    >
      <CompAvatar name={name} url={url ?? repoUrl ?? null} size={size} />
    </span>
  );
}
