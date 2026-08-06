"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import {
  ArrowRightIcon,
  LinkIcon,
  SpinnerIcon,
  DotsThreeIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  LinkBreakIcon,
} from "@/components/icons";
import { api, type ProductLinkedCompetitor } from "@/lib/api";
import { competitorsQuery, productDetailQuery, productsListQuery } from "@/lib/queries";
import { competitorNameColor } from "@/lib/competitor-color";
import { shortAge } from "@/lib/format-date";
import { toastApiError } from "@/lib/error-helpers";
import { cn } from "@/lib/utils";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import { CatText } from "@/components/dashboard/cat-pill";
import { SeverityGauge } from "@/components/outrival/severity-scale";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

// Past this, a competitor's last move stops being news and the row says so by
// dropping the headline to muted. Same window as the roster.
const QUIET_AFTER_DAYS = 7;

/**
 * The competitors this product is measured against, each leading with what it
 * just did.
 *
 * A name, an overlap score and a badge answer "who do we watch", which is the
 * question the user already knew the answer to when they opened the tab. So the
 * row carries the competitor's latest signal in its own words, under the same
 * severity gauge the roster stands in its gutter, and the shared/specific badge
 * sits inline after the name rather than being the row's point.
 *
 * The tab is also where that list is EDITED. Reading who a product is measured
 * against and changing it are the same job, and sending the user to the roster or
 * to each competitor's own page to link, unlink or retire one made a two-click
 * decision into a tour of the app.
 */
export function ProductCompetitors({
  productId,
  competitors,
}: {
  productId: string;
  competitors: ProductLinkedCompetitor[];
}) {
  const queryClient = useQueryClient();
  const [linking, setLinking] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProductLinkedCompetitor | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Which row is mid-write, so its menu can't be fired twice while the first call
  // is still out.
  const [pending, setPending] = useState<string | null>(null);

  function refresh() {
    // The junction feeds the tab, the product tile's competitor count and every
    // product-scoped roster, so a link change invalidates all three rather than
    // leaving two of them describing the list as it was.
    void queryClient.invalidateQueries({ queryKey: productDetailQuery(productId).queryKey });
    void queryClient.invalidateQueries({ queryKey: productsListQuery().queryKey });
    return queryClient.invalidateQueries({ queryKey: ["competitors"] });
  }

  async function unlink(c: ProductLinkedCompetitor) {
    setPending(c.competitorId);
    try {
      await api.detachCompetitorFromProduct(productId, c.competitorId);
      toast.success(`${c.name} removed from this product`, {
        description: "It's still tracked for your workspace. Link it back any time.",
      });
      await refresh();
    } catch (e) {
      toastApiError(e, { title: "Couldn't remove this competitor" });
    } finally {
      setPending(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteCompetitor(deleteTarget.competitorId);
      toast.success(`${deleteTarget.name} deleted`);
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      toastApiError(e);
    } finally {
      setDeleting(false);
    }
  }

  const dialogs = (
    <>
      <LinkCompetitorsDialog
        productId={productId}
        linked={competitors}
        open={linking}
        onOpenChange={setLinking}
        onChanged={refresh}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete competitor?</DialogTitle>
            <DialogDescription>
              {deleteTarget?.name} and all its monitors, snapshots, changes, signals and battle
              cards will be soft-deleted, for every product. If it came from discovery, that entry
              moves back to Dismissed. To keep watching it elsewhere, remove it from this product
              instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting && <SpinnerIcon size={16} className="animate-spin" />}
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  if (competitors.length === 0) {
    return (
      <>
        <Card className="flex flex-col items-center gap-3 border-dashed px-6 py-10 text-center">
          <p className="text-sm font-semibold">No competitors on this product yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Link competitors to it and its signals, battle cards and price comparison
            start filling in. Discovery suggests them from this product&apos;s positioning.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button asChild size="sm">
              <Link href="/dashboard/discovery">
                <MagnifyingGlassIcon size={16} />
                Find competitors
              </Link>
            </Button>
            <Button size="sm" variant="outline" onClick={() => setLinking(true)}>
              <LinkIcon size={16} />
              Link existing
            </Button>
          </div>
        </Card>
        {dialogs}
      </>
    );
  }

  // Whoever moved most recently leads; competitors with no signal at all sit last,
  // since "nothing yet" is the least useful row to read first.
  const sorted = [...competitors].sort((a, b) => {
    const at = a.latestMove ? new Date(a.latestMove.createdAt).getTime() : 0;
    const bt = b.latestMove ? new Date(b.latestMove.createdAt).getTime() : 0;
    return bt - at;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-2.5">
        <div className="min-w-0">
          <h3 className="text-content font-semibold leading-tight tracking-tight">
            What they last did
          </h3>
          <p className="mt-0.5 text-dense text-muted-foreground">
            Shared competitors are watched for every product. Specific ones only count
            here, and only they tag this product on a signal.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setLinking(true)}>
            <LinkIcon size={16} />
            Link existing
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/discovery">
              <MagnifyingGlassIcon size={16} />
              Find more
            </Link>
          </Button>
        </div>
      </div>

      <div>
        {sorted.map((c) => (
          <CompetitorRow
            key={c.competitorId}
            competitor={c}
            busy={pending === c.competitorId}
            onUnlink={() => void unlink(c)}
            onDelete={() => setDeleteTarget(c)}
          />
        ))}
      </div>

      <Button asChild size="sm" variant="ghost" className="self-start">
        <Link href={`/dashboard/signals?product=${encodeURIComponent(productId)}`}>
          See every signal on this product
        </Link>
      </Button>

      {dialogs}
    </div>
  );
}

function CompetitorRow({
  competitor: c,
  busy,
  onUnlink,
  onDelete,
}: {
  competitor: ProductLinkedCompetitor;
  busy: boolean;
  onUnlink: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const move = c.latestMove;
  const stale = move
    ? (Date.now() - new Date(move.createdAt).getTime()) / 86_400_000 > QUIET_AFTER_DAYS
    : false;
  const href = `/dashboard/competitors/${c.competitorId}`;

  return (
    <div className="group relative grid grid-cols-[0.625rem_minmax(0,1.15fr)_minmax(0,1.7fr)_1.5rem] items-center gap-x-3.5 rounded-md border-b border-border px-2 py-2.5 transition-colors hover:bg-surface-2 focus-within:bg-surface-2">
      <SeverityGauge severity={move && !stale ? move.severity : null} />

      <div className="flex min-w-0 items-center gap-2.5">
        <CompAvatar name={c.name} url={c.url} size={26} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              href={href}
              // Stretched link: the row navigates without nesting anything
              // interactive inside an <a>.
              className="min-w-0 truncate rounded-sm text-dense font-semibold outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring/50"
              style={competitorNameColor(c.color)}
            >
              {c.name}
            </Link>
          </div>
          {c.relevanceScore != null && (
            <span className="text-meta tabular-nums text-muted-foreground">
              {c.relevanceScore} overlap
            </span>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        {move ? (
          <>
            <span
              className={cn(
                "truncate text-dense leading-snug",
                stale ? "text-muted-foreground" : "font-medium text-foreground",
              )}
            >
              {move.insight}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
              <CatText category={move.category} />
              <span aria-hidden className="text-border-strong">
                ·
              </span>
              <span className="tabular-nums">{shortAge(move.createdAt)}</span>
            </span>
          </>
        ) : (
          <span className="truncate text-dense text-muted-foreground">
            Nothing detected yet.
          </span>
        )}
      </div>

      {/* Above the stretched link, or the row's own navigation would swallow every
          menu click. */}
      <div className="relative z-10 flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label={`Manage ${c.name}`}
              className="h-6 w-6 p-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 max-sm:opacity-100"
            >
              {busy ? (
                <SpinnerIcon size={16} className="animate-spin" />
              ) : (
                <DotsThreeIcon size={16} />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => router.push(href)}>
              <ArrowRightIcon size={16} /> Open detail
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onUnlink}>
              <LinkBreakIcon size={16} /> Remove from this product
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete} className="text-critical focus:text-critical">
              <TrashIcon size={16} /> Delete competitor
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/**
 * The competitors the workspace already tracks that this product is NOT measured
 * against. Without it, removing a competitor from a product was a one-way door:
 * the only way back was the competitor's own page, one at a time.
 *
 * Ticking a box links immediately, the way the mirror dialog on the competitor
 * page does. A row the user has touched in this session stays on screen even once
 * it is linked, so the list doesn't collapse under the click that changed it.
 */
function LinkCompetitorsDialog({
  productId,
  linked,
  open,
  onOpenChange,
  onChanged,
}: {
  productId: string;
  linked: ProductLinkedCompetitor[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<unknown>;
}) {
  const rosterQ = useQuery({ ...competitorsQuery(), enabled: open });
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setTouched(new Set());
  }, [open]);

  const linkedIds = new Set(linked.map((c) => c.competitorId));
  const available = (rosterQ.data ?? []).filter(
    (c) => !linkedIds.has(c.id) || touched.has(c.id),
  );

  async function toggle(competitorId: string, next: boolean) {
    setPending((p) => new Set(p).add(competitorId));
    setTouched((t) => new Set(t).add(competitorId));
    try {
      // Linking is a MOVE: a competitor belongs to exactly one product, so it leaves
      // whichever product had it. The bulk endpoint swaps the junction row in one
      // request; attaching here without detaching there was how a competitor ended up
      // in two feeds while every surface showed it in one.
      if (next) await api.bulkMoveCompetitorsToProduct([competitorId], productId);
      else await api.detachCompetitorFromProduct(productId, competitorId);
      await onChanged();
    } catch (e) {
      toastApiError(e, { title: "Couldn't update this product's competitors" });
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(competitorId);
        return n;
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link existing competitors</DialogTitle>
          <DialogDescription>
            Competitors your workspace already tracks. Linking one moves it to this
            product: its signals go in this feed and its prices on this comparison, and
            it leaves whichever product had it before.
          </DialogDescription>
        </DialogHeader>

        {rosterQ.isPending ? (
          <div className="flex justify-center py-6">
            <SpinnerIcon size={16} className="animate-spin text-muted-foreground" />
          </div>
        ) : rosterQ.isError ? (
          <p className="py-4 text-sm text-muted-foreground">
            Couldn&apos;t load your competitors.{" "}
            <button
              type="button"
              onClick={() => void rosterQ.refetch()}
              className="text-link underline underline-offset-2"
            >
              Retry
            </button>
          </p>
        ) : available.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Every competitor you track is already on this product. Discovery finds more.
          </p>
        ) : (
          <div className="-mx-1 max-h-80 space-y-0.5 overflow-y-auto px-1">
            {available.map((c) => {
              const checked = linkedIds.has(c.id);
              const isPending = pending.has(c.id);
              return (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-2"
                >
                  <Checkbox
                    checked={checked}
                    disabled={isPending}
                    onCheckedChange={(v) => void toggle(c.id, v === true)}
                  />
                  <CompAvatar name={c.name} url={c.url} size={22} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                  {isPending && <SpinnerIcon size={16} className="animate-spin text-muted-foreground" />}
                </label>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
