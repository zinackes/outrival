"use client";

import { useQuery } from "@tanstack/react-query";
import { productsListQuery, competitorsQuery } from "@/lib/queries";
import { productColorVars } from "@/lib/product-color";
import { COMP_ACCENT } from "@/lib/competitor-color";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { ProductTile } from "./product-tile";
import { cn } from "@/lib/utils";

const MAX_CHIPS = 2;
// Dense shows ONE mark. A 14px tile in a row that is already mostly a truncated name
// buys ambiguity past the first, so the rest is carried by "+N" and the title.
const MAX_DENSE_TILES = 1;

// Product attribution for a competitor, shown ONLY in all-products scope (the caller
// gates on that), listing the products it is linked to (product_competitors). The API
// sends an empty list for a competitor linked to EVERY product — attribution that
// never varies disambiguates nothing. The product's identity color is a small dot;
// the label stays muted-foreground so it never competes with the competitor's own
// name color (different visual slot, lighter weight).
//
// `dense` (the sidebar) drops the labels — but a bare colour dot next to a name is
// unlearnable: nothing in that column says which hue is which product, so it read as
// decoration. It renders the product's own mark instead (<ProductTile>: favicon ringed
// in the product colour), the same identity the switcher above it and the Products
// page already use — recognisable without a legend, and one shape for one meaning.
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

  const shown = resolved.slice(0, dense ? MAX_DENSE_TILES : MAX_CHIPS);
  const overflow = resolved.length - shown.length;

  return (
    <span
      className={cn("flex items-center gap-1.5", className)}
      // The full label of every linked product, so the dense (dot-only) variant and
      // the overflow "+N" stay discoverable on hover.
      title={resolved.map((p) => p.name).join(" · ")}
    >
      {shown.map((p) =>
        dense ? (
          <ProductTile
            key={p.id}
            name={p.name}
            url={p.url}
            repoUrl={p.repoUrl}
            position={p.position}
            size={14}
            ring
          />
        ) : (
          <span
            key={p.id}
            className="inline-flex min-w-0 items-center gap-1 text-meta text-muted-foreground"
          >
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{ ...productColorVars(p.position), background: COMP_ACCENT }}
            />
            <span className="truncate max-w-[14ch]">{p.name}</span>
          </span>
        ),
      )}
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
      productIds={competitor?.productIds}
      dense={dense}
      className={className}
    />
  );
}
