"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  CardsThreeIcon,
  CheckIcon,
  CaretDownIcon,
  CaretRightIcon,
} from "@phosphor-icons/react/ssr";
import { productDetailQuery, productsListQuery } from "@/lib/queries";
import { useSetProductScope } from "@/components/dashboard/product-scope-provider";
import { MyProductView } from "../my-product-view";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ProductTile } from "@/components/dashboard/product-tile";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// patch-28 — a single product's detail page. Reuses MyProductView (profile, pricing,
// features, tech stack, hiring, self-changes — all scoped by productId) and hands it
// the product's linked competitors, which become its Competitors tab.
export function ProductDetailView({ productId }: { productId: string }) {
  const detailQ = useQuery(productDetailQuery(productId));
  const detail = detailQ.data ?? null;
  const product = detail?.product ?? null;
  const competitors = detail?.competitors ?? [];
  const name = product?.name ?? "Product";

  // A forged / foreign / deleted product id 404s here — short-circuit with a clear
  // state instead of rendering MyProductView's "no site" empty state on top.
  if (detailQ.isError) {
    return (
      <div className="xl:px-6 2xl:px-12">
        <ProductCrumbs productId={productId} name="Product" />
        <EmptyState
          icon={CardsThreeIcon}
          title="Product not found"
          description="This product doesn't exist or you don't have access to it."
          actions={
            <Button asChild>
              <Link href="/dashboard/products?product=all">Back to products</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="xl:px-6 2xl:px-12">
      <ProductCrumbs productId={productId} name={name} />
      <MyProductView
        productId={productId}
        title={name}
        isPrimary={product?.isPrimary ?? false}
        // Loading and empty are different answers, and the tab must not claim
        // "none linked" while the request is still in flight.
        competitors={detailQ.isLoading ? undefined : competitors}
      />
    </div>
  );
}

/**
 * Products / <this one>, with the switcher on the product itself.
 *
 * Changing SKU used to mean a trip through the sidebar or Settings, which is a
 * long way round for the most frequent move on a multi-product workspace: reading
 * the same thing about the next product.
 */
function ProductCrumbs({ productId, name }: { productId: string; name: string }) {
  const router = useRouter();
  const setScope = useSetProductScope();
  const { data: products } = useQuery(productsListQuery());
  const siblings = (products ?? []).filter((p) => p.status !== "archived");
  const current = siblings.find((p) => p.id === productId);

  function goAll() {
    // Opening a product makes it the active scope, so going up has to release it,
    // otherwise the portfolio redirects straight back into this product.
    setScope(null);
    router.push("/dashboard/products?product=all");
  }

  return (
    <div className="mb-4 flex items-center gap-1.5 text-dense text-muted-foreground">
      <button
        type="button"
        onClick={goAll}
        className="rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        Products
      </button>
      <CaretRightIcon size={13} aria-hidden />
      {siblings.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2">
              <ProductTile
                name={name}
                url={current?.url}
                repoUrl={current?.repoUrl}
                position={current?.position}
                size={16}
                ring
              />
              <span className="max-w-40 truncate">{name}</span>
              <CaretDownIcon size={13} className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {siblings.map((p) => (
              <DropdownMenuItem
                key={p.id}
                className="gap-2"
                onSelect={() => {
                  if (p.id === productId) return;
                  setScope(p.id);
                  router.push(`/dashboard/products/${p.id}`);
                }}
              >
                <ProductTile
                  name={p.name}
                  url={p.url}
                  repoUrl={p.repoUrl}
                  position={p.position}
                  size={16}
                  ring
                />
                <span className="flex-1 truncate">{p.name}</span>
                {p.id === productId && <CheckIcon size={13} className="shrink-0" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={goAll}>All products</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="text-foreground">{name}</span>
      )}
    </div>
  );
}
