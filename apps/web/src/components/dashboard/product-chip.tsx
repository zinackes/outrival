"use client";

import { useQuery } from "@tanstack/react-query";
import { productsListQuery, competitorsQuery } from "@/lib/queries";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { ProductTile } from "./product-tile";
import { cn } from "@/lib/utils";

const MAX_CHIPS = 2;

// Product attribution for a competitor, shown ONLY in all-products scope (the caller
// gates on that), listing the products it is linked to (product_competitors). The API
// sends an empty list for a competitor linked to EVERY product — attribution that
// never varies disambiguates nothing. Each product wears its own <ProductTile> (favicon
// → repo host → initials, ringed in the product's color), so an attribution is read by
// logo like every other identity in the list; the label stays muted-foreground so it
// never competes with the competitor's own name color (lighter weight, same row).
export function ProductChips({
  productIds,
  className,
}: {
  productIds: string[] | undefined;
  className?: string;
}) {
  const { data: products } = useQuery(productsListQuery());

  // Meaningless for a single-SKU org (every competitor maps to the one product), so
  // the whole feature is suppressed there — and there's nothing to disambiguate.
  if (!productIds?.length || !products || products.length < 2) return null;

  // Resolve ids → the product row (name + position drives the color); drop unknown ids
  // (archived / out of scope). Order by display position for a stable color sequence.
  const resolved = productIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .sort((a, b) => a.position - b.position);
  if (!resolved.length) return null;

  const shown = resolved.slice(0, MAX_CHIPS);
  const overflow = resolved.length - shown.length;

  return (
    <span
      className={cn("flex items-center gap-2", className)}
      // The full label of every linked product, so the overflow "+N" stays
      // discoverable on hover.
      title={resolved.map((p) => p.name).join(" · ")}
    >
      {shown.map((p) => (
        <span
          key={p.id}
          className="inline-flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground"
        >
          {/* pointer-events-none: the tile carries its own `title` (the product name),
              which would otherwise shadow the parent's full product list on hover. */}
          <ProductTile
            name={p.name}
            url={p.url}
            repoUrl={p.repoUrl}
            position={p.position}
            size={14}
            ring
            className="pointer-events-none"
          />
          <span className="truncate max-w-[14ch]">{p.name}</span>
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-meta tabular-nums text-muted-foreground">
          +{overflow}
        </span>
      )}
    </span>
  );
}

// Signal surfaces (feed rows + detail card) carry only a competitorId, so resolve the
// competitor's linked products from the all-products roster cache (the same
// ["competitors"] query the sidebar/list already keep warm — no extra fetch) and
// render chips. Self-gates to all-products scope, matching the competitors surfaces.
export function CompetitorProductChips({
  competitorId,
  className,
}: {
  competitorId: string;
  className?: string;
}) {
  const productId = useProductScope();
  const { data: roster } = useQuery({
    ...competitorsQuery(undefined),
    enabled: !productId,
  });
  if (productId) return null; // scoped to one product → attribution is redundant
  const competitor = roster?.find((c) => c.id === competitorId);
  return <ProductChips productIds={competitor?.productIds} className={className} />;
}
