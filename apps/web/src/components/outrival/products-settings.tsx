"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  DotsThreeIcon,
  PencilIcon,
  PlusIcon,
  SpinnerIcon,
  StarIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons";
import { toast } from "@/lib/toast";
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
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  SettingsPageHead,
  SettingsSection,
} from "@/components/dashboard/settings-page";
import { SettingCardRowsSkeleton } from "@/components/dashboard/skeletons";
import { SettingsError } from "@/components/outrival/list-error";
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

  // Invalidate the whole ["products"] prefix, not just this page's key. The sidebar
  // switcher and the product-scope provider read ["products","list"], a sibling key:
  // refreshing only ["products","settings"] dropped the removed product from this
  // list while the switcher kept offering it, and a scope pointing at it stayed put
  // (the provider only self-heals once the list itself refetches). The portfolio and
  // the detail page already invalidate the prefix.
  function load() {
    return queryClient.invalidateQueries({ queryKey: ["products"] });
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
    <div className="flex flex-col gap-8">
      {/* The quota is page metadata, so it rides beside the title instead of
          floating between the heading and the list it describes. */}
      <SettingsPageHead
        title="Products"
        description={
          <>
            Rename, choose the primary, or stop tracking one. To read a product,{" "}
            <Link
              href="/dashboard/products?product=all"
              className="text-link underline-offset-2 hover:underline"
            >
              open it in Products
            </Link>
            .
          </>
        }
        action={
          products ? (
            <div className="flex flex-col items-end gap-1.5">
              <span className="text-dense text-muted-foreground">
                <span className="tabular-nums text-foreground">{active.length}</span> of{" "}
                <span className="tabular-nums text-foreground">{limit}</span> product
                {limit > 1 ? "s" : ""} on {PLAN_LABELS[plan]}
              </span>
              <Progress
                value={Math.round((used / Math.max(1, limit)) * 100)}
                aria-label="Products used on your plan"
                className="h-1.5 w-24"
              />
              {atLimit && (
                <Link
                  href="/dashboard/settings/billing"
                  className="text-meta text-link underline-offset-2 hover:underline"
                >
                  Upgrade to track more
                </Link>
              )}
            </div>
          ) : null
        }
      />

      <SettingsSection
        title="Tracked products"
        action={
          <Button size="sm" onClick={() => setAddOpen(true)} disabled={atLimit}>
            <PlusIcon size={16} />
            Add product
          </Button>
        }
      >
      {err != null && (
        <SettingsError title="Products didn't load" error={err} onRetry={() => void load()} />
      )}

      {!products && !err && <SettingCardRowsSkeleton rows={2} />}

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

      <p className="mt-3 text-xs text-muted-foreground">
        Removing a product stops its scans and hides it everywhere. Its competitors stay
        tracked at the workspace level, and its history is kept.
      </p>
      </SettingsSection>

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
              This stops its scans and takes the product out of your workspace.
              Competitors only it tracked move to your primary product.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirmDelete} disabled={deleting}>
              {deleting && <SpinnerIcon size={16} className="animate-spin" />}
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
              <CheckIcon size={16} />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setDraft(null)}
              aria-label="Cancel rename"
            >
              <XIcon size={16} />
            </Button>
          </form>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={`/dashboard/products/${p.id}`}
              className="truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
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

      {/* One overflow menu instead of three buttons. Rename was a permanent
          control competing with Remove while being the safer action, and below
          `sm` the cluster wrapped under the product name onto its own line. */}
      {!editing && (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {!p.isPrimary && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onSetPrimary}
              className="hidden sm:inline-flex"
            >
              <StarIcon size={16} />
              Make primary
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`More actions for ${p.name}`}
              >
                <DotsThreeIcon size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDraft(p.name)}>
                <PencilIcon size={16} />
                Rename
              </DropdownMenuItem>
              {!p.isPrimary && (
                <DropdownMenuItem onSelect={onSetPrimary} className="sm:hidden">
                  <StarIcon size={16} />
                  Make primary
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {p.isPrimary ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* Disabled rather than absent: a row whose control set
                        changes by state makes the column jump, and "why can I
                        not remove this one" is better answered than guessed. */}
                    <span>
                      <DropdownMenuItem disabled>
                        <TrashIcon size={16} />
                        Remove
                      </DropdownMenuItem>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    Make another product primary first, so the workspace keeps one.
                  </TooltipContent>
                </Tooltip>
              ) : (
                <DropdownMenuItem
                  onSelect={onRemove}
                  className="text-critical focus:text-critical"
                >
                  <TrashIcon size={16} />
                  Remove
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
