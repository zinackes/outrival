"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  BroadcastIcon,
  DotsThreeIcon,
  NotePencilIcon,
  PlusIcon,
  SpinnerIcon,
  StarIcon,
  TrashIcon,
} from "@/components/icons";
import { PLAN_LABELS, type Plan } from "@outrival/shared";
import { api, type ProductSummary } from "@/lib/api";
import { productsSettingsQuery } from "@/lib/queries";
import { toastApiError } from "@/lib/error-helpers";
import { shortAge } from "@/lib/format-date";
import { sourceLabel } from "@/lib/source-labels";
import { prettyUrl, cn } from "@/lib/utils";
import { feedItemTransition } from "@/lib/motion";
import { PageHead } from "@/components/dashboard/page-head";
import { ProductTile } from "@/components/dashboard/product-tile";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import { ActivitySpark } from "@/components/dashboard/activity-spark";
import { DeltaPill, computeDelta } from "@/components/dashboard/delta-pill";
import { TableSkeleton } from "@/components/dashboard/skeletons";
import { SelectBox } from "@/components/dashboard/select-box";
import { AddProductWizard } from "@/components/outrival/add-product-wizard";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The portfolio: every SKU on the axes that decide which one needs you today.
 *
 * It deliberately carries no summary card. The week's story is the Overview's
 * job, and a second lead here would make this page a smaller dashboard instead
 * of the one thing only it can be, a comparison between your own products. So it
 * opens straight on the line-up: who each product is up against, what moved
 * around it, where its entry price sits in that band, and whether we are still
 * capturing it.
 *
 * The rows are also where the products get managed — select, rename, promote,
 * remove — the same grammar as the competitor roster, so acting on a product no
 * longer means finding the copy of this list that lives in Settings.
 */

// The row's seven slots, dropped from the right as the column narrows (the rail
// eats ~256px). Order follows the DOM: select, gutter, product, competitors,
// activity, price, coverage, actions.
const GRID = cn(
  "grid items-center gap-x-3.5",
  "grid-cols-[1rem_0.375rem_minmax(0,1.4fr)_minmax(0,1fr)_1.75rem]",
  "@2xl:grid-cols-[1rem_0.375rem_minmax(0,1.4fr)_minmax(0,1fr)_7rem_1.75rem]",
  "@4xl:grid-cols-[1rem_0.375rem_minmax(0,1.4fr)_minmax(0,1fr)_7rem_9rem_1.75rem]",
  "@5xl:grid-cols-[1rem_0.375rem_minmax(0,1.4fr)_minmax(0,1fr)_7rem_9rem_8rem_1.75rem]",
);

export function ProductsPortfolio() {
  const queryClient = useQueryClient();
  const productsQ = useQuery(productsSettingsQuery());
  const products = productsQ.data?.products ?? null;
  const plan = (productsQ.data?.plan as Plan) ?? "free";
  const limit = productsQ.data?.limit ?? 1;
  const [addOpen, setAddOpen] = useState(false);

  // One in-flight mutation at a time, named so the dialog that owns it can show a
  // spinner without the others going quiet for no visible reason.
  const [busy, setBusy] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ProductSummary | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ProductSummary | null>(null);
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);

  // Row selection driving the bulk bar. `lastSelectedRef` anchors shift-click
  // ranges along the visible order, the same grammar as the competitor roster.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedRef = useRef<string | null>(null);

  const active = useMemo(
    () => (products ?? []).filter((p) => p.status !== "archived"),
    [products],
  );
  const atLimit = active.length >= limit;
  const visibleIds = useMemo(() => active.map((p) => p.id), [active]);

  // Keep the selection inside what is on screen: a product that leaves the list
  // (archived here or elsewhere) must not linger in "N selected". Returns `prev`
  // untouched when nothing is stale, so a stable visibleIds can't loop.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(visibleIds);
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIds]);

  const toggleSelect = useCallback(
    (id: string, range: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const anchor = lastSelectedRef.current;
        if (range && anchor && anchor !== id) {
          const a = visibleIds.indexOf(anchor);
          const b = visibleIds.indexOf(id);
          if (a !== -1 && b !== -1) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            for (let i = lo; i <= hi; i++) next.add(visibleIds[i]!);
            lastSelectedRef.current = id;
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        lastSelectedRef.current = id;
        return next;
      });
    },
    [visibleIds],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastSelectedRef.current = null;
  }, []);

  const selectionActive = selectedIds.size > 0;
  const selectedRows = useMemo(
    () => active.filter((p) => selectedIds.has(p.id)),
    [active, selectedIds],
  );
  // The primary can't be archived (the API refuses it), so a bulk remove acts on
  // the rest and says so instead of failing halfway through.
  const removableRows = useMemo(
    () => selectedRows.filter((p) => !p.isPrimary),
    [selectedRows],
  );
  const primarySelected = selectedRows.find((p) => p.isPrimary) ?? null;

  // Escape drops the selection, the way it dismisses every other transient state
  // in the product. Only bound while a selection exists.
  useEffect(() => {
    if (!selectionActive) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") clearSelection();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectionActive, clearSelection]);

  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  function toggleSelectAll() {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleIds));
    lastSelectedRef.current = null;
  }

  // Rename and archive surface on the portfolio, the detail page and the settings
  // list, all under the "products" key — invalidate the family, not one copy.
  function refresh() {
    return queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  async function onRenameSubmit(name: string) {
    if (!renameTarget) return;
    setBusy("rename");
    try {
      await api.updateProduct(renameTarget.id, { name });
      setRenameTarget(null);
      await refresh();
    } catch (e) {
      toastApiError(e, { title: "Couldn't rename the product" });
    } finally {
      setBusy(null);
    }
  }

  async function onMakePrimary(p: ProductSummary) {
    if (busy) return;
    setBusy("primary");
    try {
      await api.updateProduct(p.id, { isPrimary: true });
      toast.success(`${p.name} is now your primary product`);
      await refresh();
    } catch (e) {
      toastApiError(e, { title: "Couldn't update the product" });
    } finally {
      setBusy(null);
    }
  }

  async function onConfirmRemove() {
    if (!removeTarget) return;
    setBusy("remove");
    try {
      await api.archiveProduct(removeTarget.id);
      toast.success(`Removed ${removeTarget.name}.`);
      setRemoveTarget(null);
      await refresh();
    } catch (e) {
      toastApiError(e, { title: "Couldn't remove the product" });
    } finally {
      setBusy(null);
    }
  }

  async function onConfirmBulkRemove() {
    setBusy("bulk-remove");
    let removed = 0;
    let firstError: unknown = null;
    // Sequential on purpose: the list is small (per-tier product limits), and one
    // failure must not hide how many of the others went through.
    for (const p of removableRows) {
      try {
        await api.archiveProduct(p.id);
        removed++;
      } catch (e) {
        if (firstError === null) firstError = e;
      }
    }
    if (removed > 0) toast.success(`${removed} product${removed > 1 ? "s" : ""} removed`);
    if (firstError !== null) {
      toastApiError(firstError, {
        title: removed > 0 ? "Some products couldn't be removed" : "Couldn't remove those products",
      });
    }
    setBulkRemoveOpen(false);
    clearSelection();
    await refresh();
    setBusy(null);
  }

  return (
    <div className="xl:px-6 2xl:px-12">
      <PageHead
        title="Products"
        sub="Each product carries its own competitors, price position and battle cards."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/settings/products">Manage products</Link>
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)} disabled={atLimit}>
              <PlusIcon size={16} />
              Add product
            </Button>
          </div>
        }
      />

      {productsQ.isError && (
        <Card className="px-5 py-4 text-sm text-muted-foreground">
          Products could not be loaded. Refresh the page to try again.
        </Card>
      )}

      {!products && !productsQ.isError && <TableSkeleton rows={3} />}

      {products && active.length > 0 && (
        <div className="@container">
          <div
            className={cn(
              GRID,
              "border-b border-border px-2 pb-2 text-meta font-medium text-muted-foreground",
            )}
          >
            {/* Select-all heads its own column, directly above every row's box. Mixed
                shows a dash rather than a tick: a half-selected list that reads
                "checked" invites a click that silently deselects the rest. */}
            <SelectBox
              checked={allVisibleSelected}
              mixed={selectionActive && !allVisibleSelected}
              label={
                allVisibleSelected
                  ? "Deselect all products"
                  : `Select all ${visibleIds.length} products`
              }
              onToggle={toggleSelectAll}
            />
            <span />
            <span>Product</span>
            <span>Competitors</span>
            <ColumnLabel
              className="hidden @2xl:flex"
              tip="Signals in the last 7 days against the 7 before, on this product's competitors. The bars are one per day over 14 days."
            >
              Activity
            </ColumnLabel>
            <ColumnLabel
              className="hidden @4xl:flex"
              tip="Your cheapest paid tier, marked on the band your priced competitors occupy."
            >
              Entry price
            </ColumnLabel>
            <ColumnLabel
              className="hidden @5xl:flex"
              tip="This product's own sources, and when the last one answered."
            >
              Capture
            </ColumnLabel>
            <span />
          </div>

          {active.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              selected={selectedIds.has(p.id)}
              onToggleSelect={(range) => toggleSelect(p.id, range)}
              onRename={() => setRenameTarget(p)}
              onMakePrimary={() => void onMakePrimary(p)}
              onRemove={() => setRemoveTarget(p)}
            />
          ))}
        </div>
      )}

      {/* The page only renders with two or more products (one redirects to its own
          page), so this covers a client refetch that archived the rest. */}
      {products && active.length === 0 && (
        <Card className="border-dashed px-5 py-6 text-center text-sm text-muted-foreground">
          Every product was removed. Add one to start watching it.
        </Card>
      )}

      {products && active.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border-strong px-4 py-3 text-dense text-muted-foreground">
          <span>
            You are using{" "}
            <span className="tabular-nums text-foreground">{active.length}</span> of{" "}
            <span className="tabular-nums text-foreground">{limit}</span> products on{" "}
            {PLAN_LABELS[plan]}.
          </span>
          {atLimit ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/settings/billing">Upgrade to track more</Link>
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              <PlusIcon size={16} />
              Add product
            </Button>
          )}
        </div>
      )}

      {/* The selection bar. Sticks to the bottom of the viewport while the list is
          on screen, the same bar grammar as the competitor roster. */}
      <AnimatePresence>
        {selectedRows.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={feedItemTransition}
            className="sticky bottom-4 z-20 flex justify-center"
          >
            <div
              role="toolbar"
              aria-label={`Actions for ${selectedRows.length} selected products`}
              className="flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-surface-2 px-2 py-1.5 shadow-lg"
            >
              <span className="px-1.5 text-dense font-medium">
                <span className="tabular-nums">{selectedRows.length}</span> selected
              </span>
              <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
              {removableRows.length === 0 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button variant="ghost" size="sm" className="h-7" disabled>
                        <TrashIcon size={16} />
                        Remove
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Make another product primary first, so the workspace keeps one.
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-critical hover:text-critical"
                  disabled={busy !== null}
                  onClick={() => setBulkRemoveOpen(true)}
                >
                  <TrashIcon size={16} />
                  Remove
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={clearSelection}
                disabled={busy !== null}
              >
                Clear
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AddProductWizard
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => void refresh()}
      />

      <RenameProductDialog
        product={renameTarget}
        busy={busy === "rename"}
        onSubmit={(name) => void onRenameSubmit(name)}
        onClose={() => busy !== "rename" && setRenameTarget(null)}
      />

      <Dialog
        open={removeTarget !== null}
        onOpenChange={(o) => {
          if (!o && busy !== "remove") setRemoveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removeTarget?.name ?? "product"}?</DialogTitle>
            <DialogDescription>
              This takes the product out of your workspace and stops its scans. Its
              competitors stay tracked at the workspace level, and its history is kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRemoveTarget(null)}
              disabled={busy === "remove"}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void onConfirmRemove()}
              disabled={busy === "remove"}
            >
              {busy === "remove" && <SpinnerIcon size={16} className="animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkRemoveOpen}
        onOpenChange={(o) => {
          if (!o && busy !== "bulk-remove") setBulkRemoveOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Remove {removableRows.length} product{removableRows.length > 1 ? "s" : ""}?
            </DialogTitle>
            <DialogDescription>
              This takes them out of your workspace and stops their scans. Their
              competitors stay tracked at the workspace level, and their history is kept.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {removableRows.map((p) => p.name).join(", ")}
          </p>
          {primarySelected && (
            <p className="text-sm text-muted-foreground">
              {primarySelected.name} is your primary product and stays. Make another
              product primary first to remove it.
            </p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setBulkRemoveOpen(false)}
              disabled={busy === "bulk-remove"}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void onConfirmBulkRemove()}
              disabled={busy === "bulk-remove"}
            >
              {busy === "bulk-remove" && <SpinnerIcon size={16} className="animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Renaming from the portfolio happens in a dialog rather than inline: the row is a
 * dense grid under a stretched link, and an input swapped into it would fight both
 * the columns and the navigation.
 */
function RenameProductDialog({
  product,
  busy,
  onSubmit,
  onClose,
}: {
  product: ProductSummary | null;
  busy: boolean;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (product) setName(product.name);
  }, [product]);

  const trimmed = name.trim();
  const unchanged = product !== null && trimmed === product.name;

  return (
    <Dialog open={product !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {product?.name ?? "product"}</DialogTitle>
          <DialogDescription>
            The new name shows everywhere this product does: its page, its signals,
            its battle cards.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmed && !unchanged) onSubmit(trimmed);
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoFocus
            aria-label="Product name"
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed || unchanged || busy}>
              {busy && <SpinnerIcon size={16} className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One product. The gutter carries an open critical, which is the only state that
 * earns color before the user has read anything; everything else is neutral until
 * asked. The whole row navigates via a stretched link on the name; the select box
 * and the actions menu lift themselves above it.
 */
function ProductRow({
  product: p,
  selected,
  onToggleSelect,
  onRename,
  onMakePrimary,
  onRemove,
}: {
  product: ProductSummary;
  selected: boolean;
  onToggleSelect: (range: boolean) => void;
  onRename: () => void;
  onMakePrimary: () => void;
  onRemove: () => void;
}) {
  const stats = p.stats ?? { signals7d: 0, signalsPrev: 0, critical7d: 0, lastSignalAt: null };
  const cov = p.coverage ?? { sources: 0, failing: 0, failingSource: null };
  const delta = computeDelta(stats.signals7d, stats.signalsPrev);
  const href = `/dashboard/products/${p.id}`;

  return (
    <div
      className={cn(
        GRID,
        "group relative rounded-md border-b border-border px-2 py-2.5 transition-colors hover:bg-surface-2 focus-within:bg-surface-2",
        selected && "bg-surface-2",
      )}
    >
      <SelectBox
        checked={selected}
        label={selected ? `Deselect ${p.name}` : `Select ${p.name}`}
        onToggle={(e) => onToggleSelect(e.shiftKey)}
      />

      <span
        aria-hidden
        className={cn(
          "h-7 w-1 rounded-full",
          stats.critical7d > 0 ? "bg-critical" : "bg-transparent",
        )}
      />

      <div className="flex min-w-0 items-center gap-2.5">
        <ProductTile
          name={p.name}
          url={p.url}
          repoUrl={p.repoUrl}
          position={p.position}
          size={28}
          ring
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              href={href}
              // Stretched link: the whole row navigates without nesting anything
              // interactive inside an <a>.
              className="min-w-0 truncate rounded-sm text-dense font-semibold outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring/50"
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
            {p.stage === "developing" && (
              <span className="shrink-0 rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-meta font-medium text-muted-foreground">
                In development
              </span>
            )}
          </div>
          <span className="truncate font-mono text-meta text-muted-foreground">
            {p.url
              ? prettyUrl(p.url)
              : p.repoUrl
                ? prettyUrl(p.repoUrl)
                : "No site or repo yet"}
          </span>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        {p.topCompetitors?.length ? (
          <>
            <span className="flex items-center">
              {p.topCompetitors.map((c) => (
                <span key={c.id} className="-ml-1.5 first:ml-0">
                  <CompAvatar name={c.name} url={c.url} size={20} />
                </span>
              ))}
            </span>
            <span className="truncate text-dense text-muted-foreground">
              {p.competitorCount > (p.topCompetitors?.length ?? 0)
                ? `+${p.competitorCount - (p.topCompetitors?.length ?? 0)} more`
                : p.topCompetitors.map((c) => c.name).join(", ")}
            </span>
          </>
        ) : (
          <span className="text-dense text-muted-foreground">None linked yet</span>
        )}
      </div>

      <div className="hidden min-w-0 flex-col gap-1.5 @2xl:flex">
        <span className="flex items-baseline gap-2">
          <span className="text-dense font-semibold tabular-nums">
            {stats.signals7d}
          </span>
          {stats.signals7d > 0 ? (
            <DeltaPill delta={delta} />
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </span>
        <ActivitySpark
          values={p.activity ?? []}
          label={`${stats.signals7d} signals in the last 7 days`}
        />
      </div>

      <div className="hidden min-w-0 @4xl:flex">
        <PriceBand pricing={p.pricing} />
      </div>

      <div className="hidden min-w-0 flex-col gap-0.5 text-xs @5xl:flex">
        {cov.failing > 0 ? (
          <>
            <span className="flex min-w-0 items-center gap-1.5 font-medium text-high">
              <span className="size-1.5 shrink-0 rounded-full bg-high" />
              <span className="truncate">{sourceLabel(cov.failingSource)} blocked</span>
            </span>
            <span className="text-meta tabular-nums text-muted-foreground">
              {cov.sources - cov.failing} of {cov.sources} live
            </span>
          </>
        ) : cov.sources > 0 ? (
          <>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full bg-positive" />
              {cov.sources} source{cov.sources > 1 ? "s" : ""} live
            </span>
            <span className="text-meta tabular-nums text-muted-foreground">
              {p.lastScanAt ? `${shortAge(p.lastScanAt)} ago` : "never scanned"}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Nothing watched yet</span>
        )}
      </div>

      <div className="relative z-10 flex items-center justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`More actions for ${p.name}`}
              className="h-6 w-6 p-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <DotsThreeIcon size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={onRename}>
              <NotePencilIcon size={16} /> Rename…
            </DropdownMenuItem>
            {!p.isPrimary && (
              <DropdownMenuItem onSelect={onMakePrimary}>
                <StarIcon size={16} /> Make primary
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link href={`${href}/sources`}>
                <BroadcastIcon size={16} /> Manage sources
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {p.isPrimary ? (
              <>
                <DropdownMenuItem disabled>
                  <TrashIcon size={16} /> Remove
                </DropdownMenuItem>
                <p className="px-2 py-1.5 text-meta text-muted-foreground">
                  Make another product primary first, so the workspace keeps one.
                </p>
              </>
            ) : (
              <DropdownMenuItem
                onSelect={onRemove}
                className="text-critical focus:text-critical"
              >
                <TrashIcon size={16} /> Remove
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function ColumnLabel({
  children,
  tip,
  className,
}: {
  children: React.ReactNode;
  tip: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("cursor-help items-center", className)}>{children}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px]">{tip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Your entry price marked on the band your priced competitors occupy.
 *
 * The band needs two rivals to be a band at all: with one, the marker would imply
 * a market from a single point, so the cell says what is missing instead. The gap
 * is stated against the median, since one enterprise list price would drag a mean
 * far above anything a buyer chooses between.
 */
function PriceBand({ pricing }: { pricing: ProductSummary["pricing"] }) {
  const entry = pricing?.entry ?? null;
  const { entryMonthly = null, median, low, high, rivalsPriced = 0 } = pricing ?? {};

  // The band is a monthly axis, so our own number has to be read on it too (an
  // annual plan ÷12, marked "≈"). A one-time price reaches no monthly axis at all.
  if (!entry || entryMonthly === null) {
    return (
      <span className="text-dense text-muted-foreground">
        {entry ? "One-time price" : rivalsPriced > 0 ? "No price of your own" : "Not priced"}
      </span>
    );
  }

  const rounded = Math.round(entryMonthly);
  const amount = `${entry.billingPeriod === "monthly" ? "" : "≈"}${
    entry.currency === "USD" ? "$" : ""
  }${rounded}${entry.currency === "USD" ? "" : ` ${entry.currency}`}`;

  if (median == null || low == null || high == null || rivalsPriced < 2) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-dense font-semibold tabular-nums">{amount}</span>
        <span className="text-meta text-muted-foreground">
          {rivalsPriced === 1 ? "1 rival priced" : "no priced rival"}
        </span>
      </div>
    );
  }

  // Position on the band, clamped so a price outside the rivals' range still
  // renders at an edge rather than escaping the track.
  const span = Math.max(1, high - low);
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - low) / span) * 100));
  const gap = Math.round(((entryMonthly - median) / median) * 100);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="relative block h-[5px] rounded-sm bg-surface-3">
        <span
          aria-hidden
          className="absolute inset-y-0 rounded-sm bg-muted-foreground/30"
          style={{ left: "0%", right: "0%" }}
        />
        <span
          aria-hidden
          className="absolute top-[-2px] h-[9px] w-px bg-muted-foreground"
          style={{ left: `${pct(median)}%` }}
        />
        <span
          aria-hidden
          className="absolute top-[-3px] h-[11px] w-[2px] rounded-sm bg-primary"
          style={{ left: `${pct(entryMonthly)}%` }}
        />
      </span>
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="text-dense font-semibold tabular-nums">{amount}</span>
        <span className="truncate text-meta text-muted-foreground">
          {gap === 0
            ? "at median"
            : `${Math.abs(gap)}% ${gap < 0 ? "under" : "over"} median`}
        </span>
      </span>
    </div>
  );
}
