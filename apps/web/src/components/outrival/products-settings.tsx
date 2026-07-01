"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, ChevronRight, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { toastApiError } from "@/lib/error-helpers";
import { productsSettingsQuery } from "@/lib/queries";
import { PLAN_LABELS, type Plan } from "@outrival/shared";
import { AddProductWizard } from "@/components/outrival/add-product-wizard";

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
  // Soft-archive on the backend, but presented as a delete: confirm before
  // removing a product from the workspace.
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  function load() {
    return queryClient.invalidateQueries({ queryKey: productsSettingsQuery().queryKey });
  }

  const active = (products ?? []).filter((p) => p.status !== "archived");
  const atLimit = active.length >= limit;

  async function onSetPrimary(id: string) {
    try {
      await api.updateProduct(id, { isPrimary: true });
      load();
    } catch (e) {
      toastApiError(e, { title: "Couldn't update the product" });
    }
  }

  async function onConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.archiveProduct(deleteTarget.id);
      toast.success(`Product "${deleteTarget.name}" deleted.`);
      setDeleteTarget(null);
      load();
    } catch (e) {
      toastApiError(e, { title: "Couldn't delete the product" });
    } finally {
      setDeleting(false);
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
                  variant="danger"
                  size="sm"
                  onClick={() => setDeleteTarget({ id: p.id, name: p.name })}
                  aria-label="Delete product"
                >
                  <Trash2 size={14} className="mr-1" />
                  Delete
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>

      <AddProductWizard open={addOpen} onOpenChange={setAddOpen} onCreated={load} />

      <Dialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name ?? "product"}?</DialogTitle>
            <DialogDescription>
              This removes the product from your workspace and can&apos;t be undone from
              here. Its competitors stay tracked at the workspace level.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirmDelete} disabled={deleting}>
              {deleting && <Loader2 size={14} className="mr-1 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
