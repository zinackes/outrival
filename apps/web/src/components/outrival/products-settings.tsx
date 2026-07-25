"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, type ProductSummary } from "@/lib/api";
import { toastApiError } from "@/lib/error-helpers";
import { productsSettingsQuery } from "@/lib/queries";
import { prettyUrl } from "@/lib/utils";
import { PLAN_LABELS, type Plan } from "@outrival/shared";
import { ProductTile } from "@/components/dashboard/product-tile";
import { AddProductWizard } from "@/components/outrival/add-product-wizard";

// patch-28 — manage the org's products (SKUs): add (within the per-tier limit),
// rename, promote a primary, remove. Reading a product belongs to /dashboard/products
// (the portfolio); this page owns the lifecycle only, so the two stopped being two
// half-answers to "where are my products".
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
  // Soft-archive on the backend, but presented as removal: confirm before taking
  // a product out of the workspace.
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  function load() {
    return queryClient.invalidateQueries({ queryKey: productsSettingsQuery().queryKey });
  }

  const active = (products ?? []).filter((p) => p.status !== "archived");
  const atLimit = active.length >= limit;
  const used = Math.min(active.length, limit);

  async function onSetPrimary(id: string) {
    try {
      await api.updateProduct(id, { isPrimary: true });
      load();
    } catch (e) {
      toastApiError(e, { title: "Couldn't update the product" });
    }
  }

  async function onRename(id: string, name: string) {
    try {
      await api.updateProduct(id, { name });
      load();
    } catch (e) {
      toastApiError(e, { title: "Couldn't rename the product" });
    }
  }

  async function onConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.archiveProduct(deleteTarget.id);
      toast.success(`Removed ${deleteTarget.name}.`);
      setDeleteTarget(null);
      load();
    } catch (e) {
      toastApiError(e, { title: "Couldn't remove the product" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-medium">Products</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Rename, choose the primary, or stop tracking one. To read a product,{" "}
            <Link
              href="/dashboard/products?product=all"
              className="text-link underline-offset-2 hover:underline"
            >
              open it in Products
            </Link>
            .
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} disabled={atLimit}>
          <Plus size={14} />
          Add product
        </Button>
      </div>

      {products && (
        <div className="flex flex-wrap items-center gap-3 text-dense text-muted-foreground">
          <span
            aria-hidden
            className="h-[5px] w-28 overflow-hidden rounded-sm bg-surface-3"
          >
            <span
              className="block h-full rounded-sm bg-primary"
              style={{ width: `${Math.round((used / Math.max(1, limit)) * 100)}%` }}
            />
          </span>
          <span>
            <span className="font-mono tabular-nums text-foreground">{active.length}</span> of{" "}
            <span className="font-mono tabular-nums text-foreground">{limit}</span> product
            {limit > 1 ? "s" : ""} on {PLAN_LABELS[plan]}
          </span>
          {atLimit && (
            <Link
              href="/dashboard/settings/billing"
              className="text-link underline-offset-2 hover:underline"
            >
              Upgrade to track more
            </Link>
          )}
        </div>
      )}

      {err != null && <p className="text-sm text-destructive">Couldn&apos;t load products.</p>}

      {!products && !err && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {active.length > 0 && (
        <Card className="divide-y divide-border p-0">
          {active.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              onRename={(name) => void onRename(p.id, name)}
              onSetPrimary={() => void onSetPrimary(p.id)}
              onRemove={() => setDeleteTarget({ id: p.id, name: p.name })}
            />
          ))}
        </Card>
      )}

      <p className="text-dense text-muted-foreground">
        Removing a product stops its scans and hides it everywhere. Its competitors stay
        tracked at the workspace level, and its history is kept.
      </p>

      <AddProductWizard open={addOpen} onOpenChange={setAddOpen} onCreated={load} />

      <Dialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {deleteTarget?.name ?? "product"}?</DialogTitle>
            <DialogDescription>
              This takes the product out of your workspace and stops its scans. Its
              competitors stay tracked at the workspace level.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirmDelete} disabled={deleting}>
              {deleting && <Loader2 size={14} className="animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * One product's lifecycle row.
 *
 * Every row carries the same three controls, with the primary's Remove disabled
 * rather than absent: rows that grow and shrink their control set by state make
 * the column jump, and "why can I not remove this one" is a better question to
 * answer in a tooltip than to leave the user guessing.
 */
function ProductRow({
  product: p,
  onRename,
  onSetPrimary,
  onRemove,
}: {
  product: ProductSummary;
  onRename: (name: string) => void;
  onSetPrimary: () => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  function commit() {
    const next = (draft ?? "").trim();
    setDraft(null);
    if (next && next !== p.name) onRename(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <ProductTile
        name={p.name}
        url={p.url}
        repoUrl={p.repoUrl}
        position={p.position}
        size={26}
        ring
      />

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {editing ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              commit();
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
              autoFocus
              className="h-8 max-w-64"
              aria-label={`Rename ${p.name}`}
            />
            <Button type="submit" size="sm" variant="ghost" aria-label="Save name">
              <Check size={14} />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setDraft(null)}
              aria-label="Cancel rename"
            >
              <X size={14} />
            </Button>
          </form>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={`/dashboard/products/${p.id}`}
              className="truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {p.name}
            </Link>
            {p.isPrimary && (
              <span className="shrink-0 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-muted-foreground">
                Primary
              </span>
            )}
            {p.stage === "idea" && (
              <span className="shrink-0 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-muted-foreground">
                Not live
              </span>
            )}
          </div>
        )}
        <span className="truncate text-meta text-muted-foreground">
          <span className="font-mono">
            {p.url ? prettyUrl(p.url) : p.repoUrl ? prettyUrl(p.repoUrl) : "No site yet"}
          </span>
          {" · "}
          {p.competitorCount} competitor{p.competitorCount === 1 ? "" : "s"}
        </span>
      </div>

      {!editing && (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setDraft(p.name)}>
            Rename
          </Button>
          {p.isPrimary ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button variant="ghost" size="sm" disabled aria-label="Remove product">
                    <Trash2 size={14} />
                    Remove
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Make another product primary first, so the workspace keeps one.
              </TooltipContent>
            </Tooltip>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={onSetPrimary}>
                <Star size={14} />
                Make primary
              </Button>
              <Button variant="danger" size="sm" onClick={onRemove}>
                <Trash2 size={14} />
                Remove
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
