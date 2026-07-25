"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Loader2, SignalHigh, Boxes } from "lucide-react";
import { useSetProductScope } from "@/components/dashboard/product-scope-provider";
import { productDetailQuery } from "@/lib/queries";
import { MyProductView } from "../my-product-view";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// patch-28 — a single product's detail page. Reuses MyProductView (profile, pricing,
// features, tech stack, hiring, self-changes — all scoped by productId) and adds the
// product-specific surfaces around it: its linked competitors and a scoped signals link.
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
        <BackLink />
        <EmptyState
          icon={Boxes}
          title="Product not found"
          description="This product doesn't exist or you don't have access to it."
          actions={
            <Button asChild>
              <Link href="/dashboard/settings/products">Back to products</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="xl:px-6 2xl:px-12">
      <BackLink />

      <MyProductView productId={productId} title={name} isPrimary={product?.isPrimary ?? false} />

      <div className="mt-6">
        <Card className="bg-gradient-card-strong p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-dense font-semibold uppercase tracking-wide text-muted-foreground">
              Competitors{competitors.length > 0 ? ` (${competitors.length})` : ""}
            </h3>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/dashboard/signals?product=${encodeURIComponent(productId)}`}>
                <SignalHigh className="size-3.5" />
                View signals
              </Link>
            </Button>
          </div>
          <Separator className="mb-2" />
          {detailQ.isLoading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading competitors…
            </div>
          ) : competitors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No competitors linked to this product yet. Link competitors from each
              competitor&apos;s page.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {competitors.map((c) => (
                <li
                  key={c.competitorId}
                  className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <Link
                    href={`/dashboard/competitors/${c.competitorId}`}
                    className="min-w-0 flex-1 truncate text-content font-medium hover:underline"
                  >
                    {c.name}
                  </Link>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={c.isSpecific ? "outline" : "secondary"} className="text-meta">
                      {c.isSpecific ? "specific" : "shared"}
                    </Badge>
                    {c.url && (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Open competitor site"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * Back to the portfolio, not to Settings: leaving a product used to swap the main
 * rail for the settings one, so changing product meant leaving the product area.
 *
 * Opening a product makes it the active scope (sidebar.tsx writes it back), so
 * going up has to release that scope too, otherwise the workspace stays pinned to
 * a product the user just left and the portfolio redirects straight back into it.
 */
function BackLink() {
  const router = useRouter();
  const setScope = useSetProductScope();
  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => {
          setScope(null);
          router.push("/dashboard/products?product=all");
        }}
        className="inline-flex items-center gap-1 rounded-sm text-dense text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ArrowLeft className="size-3.5" />
        All products
      </button>
    </div>
  );
}
