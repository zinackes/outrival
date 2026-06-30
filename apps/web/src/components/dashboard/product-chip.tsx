"use client";

import { useQuery } from "@tanstack/react-query";
import { productsListQuery, competitorsQuery } from "@/lib/queries";
import { productColorVars } from "@/lib/product-color";
import { COMP_ACCENT } from "@/lib/competitor-color";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { cn } from "@/lib/utils";

const MAX_CHIPS = 2;

// Product attribution for a competitor, shown ONLY in all-products scope (the caller
// gates on that) and ONLY for the products a competitor is *specific* to
// (product_competitors.isSpecific). A competitor shared across products renders
// nothing — that's the anti-noise rule. The product's identity color is a small dot;
// the label stays muted-foreground so it never competes with the competitor's own
// name color (different visual slot, lighter weight). `dense` drops the labels (just
// dots) for tight surfaces like the sidebar.
export function ProductChips({
  productIds,
  dense = false,
  className,
}: {
  productIds: string[] | undefined;
  dense?: boolean;
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
      className={cn("flex items-center gap-1.5", className)}
      // The full label of every specific product, so the dense (dot-only) variant and
      // the overflow "+N" stay discoverable on hover.
      title={resolved.map((p) => p.name).join(" · ")}
    >
      {shown.map((p) => (
        <span
          key={p.id}
          className={cn(
            "inline-flex items-center gap-1 text-meta text-muted-foreground",
            !dense && "min-w-0",
          )}
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ ...productColorVars(p.position), background: COMP_ACCENT }}
          />
          {!dense && <span className="truncate max-w-[14ch]">{p.name}</span>}
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
// competitor's specific products from the all-products roster cache (the same
// ["competitors"] query the sidebar/list already keep warm — no extra fetch) and
// render chips. Self-gates to all-products scope, matching the competitors surfaces.
export function CompetitorProductChips({
  competitorId,
  dense = false,
  className,
}: {
  competitorId: string;
  dense?: boolean;
  className?: string;
}) {
  const productId = useProductScope();
  const { data: roster } = useQuery({
    ...competitorsQuery(undefined),
    enabled: !productId,
  });
  if (productId) return null; // scoped to one product → attribution is redundant
  const competitor = roster?.find((c) => c.id === competitorId);
  return (
    <ProductChips
      productIds={competitor?.specificProductIds}
      dense={dense}
      className={className}
    />
  );
}
