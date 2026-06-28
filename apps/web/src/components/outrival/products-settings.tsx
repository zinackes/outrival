"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Boxes, ChevronRight, Loader2, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { productsSettingsQuery } from "@/lib/queries";
import { PLAN_LABELS, type Plan } from "@outrival/shared";

// patch-28 — manage the org's products (SKUs): add (within the per-tier limit),
// promote a primary, archive. Per-competitor sharing/reclassification is managed
// from each competitor; this page owns the product lifecycle.
export function ProductsSettings() {
  // Server-seeded on first paint (settings/products/page.tsx); listProducts returns
  // products + plan + limit together, so one query backs the page. Mutations call
  // load() to invalidate and refetch.
  const queryClient = useQueryClient();
  const productsQ = useQuery(productsSettingsQuery());
  const products = productsQ.data?.products ?? null;
  const plan = (productsQ.data?.plan as Plan) ?? "free";
  const limit = productsQ.data?.limit ?? 1;
  const err = productsQ.error;

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    return queryClient.invalidateQueries({ queryKey: productsSettingsQuery().queryKey });
  }

  const active = (products ?? []).filter((p) => p.status !== "archived");
  const atLimit = active.length >= limit;

  async function onAdd() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.createProduct({
        name: name.trim(),
        url: url.trim() || undefined,
      });
      toast.success(`Product "${name.trim()}" added.`);
      setAddOpen(false);
      setName("");
      setUrl("");
      load();
    } catch (e) {
      if (e instanceof ApiError && e.code === "plan_limit_products") {
        const suggested = e.data.suggestedPlan as Plan | undefined;
        toast.error(
          `You've reached your plan's product limit (${e.data.limit}).` +
            (suggested ? ` Upgrade to ${PLAN_LABELS[suggested]} for more.` : ""),
        );
      } else {
        toast.error(e instanceof Error ? e.message : "Failed to add product.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSetPrimary(id: string) {
    try {
      await api.updateProduct(id, { isPrimary: true });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update product.");
    }
  }

  async function onArchive(id: string) {
    try {
      await api.archiveProduct(id);
      toast.success("Product archived.");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to archive product.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-medium">Products</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {products
              ? `${active.length} of ${limit} product${limit > 1 ? "s" : ""} · ${PLAN_LABELS[plan]} plan`
              : "Your products (SKUs). Each has its own competitors and battle cards."}
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} disabled={atLimit}>
          <Plus size={14} className="mr-1" />
          Add product
        </Button>
      </div>

      {atLimit && products && (
        <p className="text-xs text-muted-foreground">
          You&apos;ve reached the {PLAN_LABELS[plan]} plan limit of {limit} product
          {limit > 1 ? "s" : ""}. Upgrade to track more.
        </p>
      )}

      {err != null && (
        <p className="text-sm text-destructive">Couldn&apos;t load products.</p>
      )}

      {!products && !err && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      <div className="flex flex-col gap-2">
        {active.map((p) => (
          <Card key={p.id} className="p-4 flex flex-row items-center justify-between gap-4">
            <Link
              href={`/dashboard/products/${p.id}`}
              className="group min-w-0 flex-1 flex items-center gap-2"
            >
              <Boxes size={14} className="text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate group-hover:underline">{p.name}</span>
                  {p.isPrimary && (
                    <Badge variant="secondary" className="text-meta">
                      Primary
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1 truncate">
                  {p.url ?? "No site yet"} · {p.competitorCount} competitor
                  {p.competitorCount === 1 ? "" : "s"}
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground/60 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
            {!p.isPrimary && (
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onSetPrimary(p.id)}
                  aria-label="Set as primary"
                >
                  <Star size={14} className="mr-1" />
                  Set primary
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onArchive(p.id)}
                  aria-label="Archive product"
                >
                  <Archive size={14} />
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a product</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="product-name">Name</Label>
              <Input
                id="product-name"
                placeholder="Marketing Hub"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="product-url">Site URL (optional)</Label>
              <Input
                id="product-url"
                placeholder="https://example.com/marketing"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                With a URL we start monitoring the product right away.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={onAdd} disabled={busy || !name.trim()}>
              {busy && <Loader2 size={14} className="mr-1 animate-spin" />}
              Add product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
