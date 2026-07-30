"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  BellIcon,
  BellSlashIcon,
  CardsThreeIcon,
  CrosshairIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SparkleIcon,
  SpinnerIcon,
  TrashIcon,
} from "@/components/icons";
import {
  ALL_CONFIGURABLE_SOURCES,
  isReviewSource,
  type SourceType,
} from "@outrival/shared";
import { api } from "@/lib/api";
import { productsListQuery } from "@/lib/queries";
import { sourceLabel } from "@/lib/source-labels";
import { toastApiError } from "@/lib/error-helpers";
import { paywallFromError, type PaywallReason } from "@/components/outrival/paywall-dialog";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { feedItemTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * How many competitors one AI action may cover, mirroring BULK_AI_MAX in the API. The
 * re-score puts every selected competitor's evidence in a single prompt, so this is the
 * cap that keeps the reply from being truncated into "nobody scored" — stated here so
 * the bar can disable the action instead of letting the request 400.
 */
const BULK_AI_MAX = 25;

/**
 * Sources that can be switched on across a selection: every configurable source that
 * needs no per-competitor URL. App Store reviews and a GitHub repo can't be derived
 * from a domain (they'd create monitors that fail every run), and `homepage` is seeded
 * on every competitor already, so offering it could only ever report "nothing added".
 */
const BULK_SOURCES: readonly SourceType[] = ALL_CONFIGURABLE_SOURCES.filter(
  (s) => !isReviewSource(s) && s !== "github_repo" && s !== "homepage",
);

export interface BulkTarget {
  id: string;
  name: string;
  monitoringPaused?: boolean;
  alertsMuted?: boolean;
}

/**
 * The roster's selection bar. Sticks to the bottom of the viewport while the list is on
 * screen, so acting on a selection never means scrolling back to a toolbar — and never
 * pushes the rows around either.
 *
 * Two verbs sit in the open (monitoring and alerts, the states the roster itself shows),
 * everything rarer or irreversible is one menu deep. Each verb reads the selection to
 * decide its direction: a set that is entirely paused offers Resume, anything else
 * offers Pause, so one click always has a defined outcome on every selected row.
 */
export function CompetitorsBulkBar({
  selected,
  onClear,
  onRefresh,
  onPaywall,
}: {
  selected: BulkTarget[];
  onClear: () => void;
  onRefresh: () => Promise<unknown>;
  onPaywall: (reason: PaywallReason) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);

  const count = selected.length;
  const ids = selected.map((c) => c.id);
  const noun = `${count} competitor${count > 1 ? "s" : ""}`;
  // Direction of each toggle: only an all-paused / all-muted selection reverses it.
  const allPaused = count > 0 && selected.every((c) => c.monitoringPaused);
  const allMuted = count > 0 && selected.every((c) => c.alertsMuted);
  const overAiCap = count > BULK_AI_MAX;

  const { data: products } = useQuery(productsListQuery());
  // Moving between products only means something with somewhere to move to.
  const multiProduct = (products?.filter((p) => p.status !== "archived").length ?? 0) > 1;

  // Every action runs the same way: name it (so the bar can show which one is in
  // flight), do it, report it, then let the caller refetch the roster. A plan gate
  // comes back as a paywall reason rather than an error toast — the same handling the
  // single-competitor actions get.
  async function run(key: string, failTitle: string, fn: () => Promise<string>) {
    if (busy) return;
    setBusy(key);
    try {
      const message = await fn();
      toast.success(message);
      await onRefresh();
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) onPaywall(reason);
      else toastApiError(e, { title: failTitle });
    } finally {
      setBusy(null);
    }
  }

  function toggleMonitoring() {
    const paused = !allPaused;
    void run("monitoring", paused ? "Couldn't pause monitoring" : "Couldn't resume monitoring", async () => {
      const res = await api.bulkSetCompetitorMonitoring(ids, paused);
      return `Monitoring ${paused ? "paused" : "resumed"} on ${res.updated} competitor${
        res.updated > 1 ? "s" : ""
      }`;
    });
  }

  function toggleAlerts() {
    const muted = !allMuted;
    void run("alerts", muted ? "Couldn't mute alerts" : "Couldn't unmute alerts", async () => {
      const res = await api.bulkSetCompetitorAlerts(ids, muted);
      return `Alerts ${muted ? "muted" : "unmuted"} on ${res.updated} competitor${
        res.updated > 1 ? "s" : ""
      }`;
    });
  }

  function recomputeOverlap() {
    void run("overlap", "Couldn't recompute overlap", async () => {
      const res = await api.bulkRecomputeCompetitorOverlap(ids);
      if (res.scored.length === 0) {
        // Nothing was written, so say why rather than claim a re-score happened.
        return `No score changed — ${skipSummary(res.skipped)}`;
      }
      const head = `${res.scored.length} overlap score${res.scored.length > 1 ? "s" : ""} updated`;
      return res.skipped.length > 0
        ? `${head} · ${res.skipped.length} skipped (${skipSummary(res.skipped)})`
        : head;
    });
  }

  function refreshSummaries() {
    void run("summary", "Couldn't refresh those summaries", async () => {
      const res = await api.bulkRefreshCompetitorSummaries(ids);
      return `Refreshing ${res.enqueued} AI summar${res.enqueued > 1 ? "ies" : "y"} — each row updates as it lands`;
    });
  }

  async function exportCsv() {
    if (busy) return;
    setBusy("export");
    try {
      const blob = await api.exportSignals({ competitors: ids });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `outrival-signals-${count}-competitors.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toastApiError(e, { title: "Couldn't export those signals" });
    } finally {
      setBusy(null);
    }
  }

  function deleteSelection() {
    void run("delete", "Couldn't delete those competitors", async () => {
      const res = await api.bulkDeleteCompetitors(ids);
      setConfirmDelete(false);
      onClear();
      return `${res.deleted} competitor${res.deleted > 1 ? "s" : ""} deleted`;
    });
  }

  return (
    <>
      <AnimatePresence>
        {count > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={feedItemTransition}
            className="sticky bottom-4 z-20 flex justify-center"
          >
            <div
              role="toolbar"
              aria-label={`Actions for ${noun}`}
              className="flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-surface-2 px-2 py-1.5 shadow-lg"
            >
              <span className="px-1.5 text-dense font-medium">
                <span className="tabular-nums">{count}</span> selected
              </span>
              <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />

              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                disabled={busy !== null}
                onClick={toggleMonitoring}
              >
                {busy === "monitoring" ? (
                  <SpinnerIcon size={16} className="animate-spin" />
                ) : allPaused ? (
                  <PlayIcon size={16} />
                ) : (
                  <PauseIcon size={16} />
                )}
                {allPaused ? "Resume" : "Pause"}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                disabled={busy !== null}
                onClick={toggleAlerts}
              >
                {busy === "alerts" ? (
                  <SpinnerIcon size={16} className="animate-spin" />
                ) : allMuted ? (
                  <BellIcon size={16} />
                ) : (
                  <BellSlashIcon size={16} />
                )}
                {allMuted ? "Unmute" : "Mute"}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="More bulk actions"
                    disabled={busy !== null}
                  >
                    <DotsThreeIcon size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuItem disabled={overAiCap} onSelect={recomputeOverlap}>
                    <CrosshairIcon size={16} /> Recompute overlap
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={overAiCap} onSelect={refreshSummaries}>
                    <SparkleIcon size={16} /> Refresh AI summary
                  </DropdownMenuItem>
                  {overAiCap && (
                    <p className="px-2 py-1.5 text-meta text-muted-foreground">
                      AI actions cover up to{" "}
                      <span className="tabular-nums">{BULK_AI_MAX}</span> competitors at
                      a time.
                    </p>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setSourceOpen(true)}>
                    <PlusIcon size={16} /> Add a source…
                  </DropdownMenuItem>
                  {multiProduct && (
                    <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
                      <CardsThreeIcon size={16} /> Move to product…
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => void exportCsv()}>
                    <DownloadSimpleIcon size={16} /> Export signals (CSV)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setConfirmDelete(true)}
                    className="text-critical focus:text-critical"
                  >
                    <TrashIcon size={16} /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={onClear}
                disabled={busy !== null}
              >
                Clear
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {noun}?</DialogTitle>
            <DialogDescription>
              Their monitors, snapshots, changes, signals and battle cards will be
              soft-deleted. This cannot be undone from the UI.
            </DialogDescription>
          </DialogHeader>
          <SelectionPreview selected={selected} />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmDelete(false)}
              disabled={busy === "delete"}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={deleteSelection}
              disabled={busy === "delete"}
            >
              {busy === "delete" && <SpinnerIcon size={16} className="animate-spin" />}
              {busy === "delete" ? "Deleting…" : `Delete ${noun}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddSourceDialog
        open={sourceOpen}
        onOpenChange={setSourceOpen}
        count={count}
        busy={busy === "source"}
        onSubmit={(sourceType) =>
          run("source", "Couldn't add that source", async () => {
            const res = await api.bulkEnableCompetitorSource(ids, sourceType);
            setSourceOpen(false);
            if (res.created === 0) {
              return `${sourceLabel(sourceType)} was already being watched on ${
                count > 1 ? "all of them" : "it"
              }`;
            }
            return `${sourceLabel(sourceType)} added on ${res.competitorsTouched} competitor${
              res.competitorsTouched > 1 ? "s" : ""
            } — first scan queued`;
          })
        }
      />

      <MoveToProductDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        count={count}
        products={products?.filter((p) => p.status !== "archived") ?? []}
        busy={busy === "product"}
        onSubmit={(productId, productName) =>
          run("product", "Couldn't move those competitors", async () => {
            const res = await api.bulkMoveCompetitorsToProduct(ids, productId);
            setMoveOpen(false);
            return `${res.moved} competitor${res.moved > 1 ? "s" : ""} moved to ${productName}`;
          })
        }
      />
    </>
  );
}

/**
 * Which competitors a destructive action is about to hit, by name. The count alone
 * makes the user trust their own memory of a selection they may have shift-clicked
 * thirty rows ago.
 */
function SelectionPreview({ selected }: { selected: BulkTarget[] }) {
  const shown = selected.slice(0, 8);
  const rest = selected.length - shown.length;
  return (
    <p className="text-sm text-muted-foreground">
      {shown.map((c) => c.name).join(", ")}
      {rest > 0 && <span className="tabular-nums"> and {rest} more</span>}
    </p>
  );
}

// Turns the API's per-row skip reasons into one clause a user can act on. The reasons
// are stable strings from the overlap scorer, not free text.
function skipSummary(skipped: Array<{ reason: string }>): string {
  const reasons = new Set(skipped.map((s) => s.reason));
  if (reasons.has("no_profile")) return "your product profile is missing";
  if (reasons.size === 1 && reasons.has("no_evidence")) {
    return "no AI summary to judge them on yet";
  }
  if (reasons.size === 1 && reasons.has("no_url")) return "they have no URL";
  if (reasons.size === 1 && reasons.has("failed")) return "the AI didn't answer";
  return "not enough about them yet";
}

function AddSourceDialog({
  open,
  onOpenChange,
  count,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  busy: boolean;
  onSubmit: (sourceType: SourceType) => void;
}) {
  const [source, setSource] = useState<SourceType | null>(null);

  useEffect(() => {
    if (!open) setSource(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a source</DialogTitle>
          <DialogDescription>
            Start watching one more page on all{" "}
            <span className="tabular-nums">{count}</span> selected competitors. A
            competitor that already has it is left alone, and nothing is turned back on
            behind your back.
          </DialogDescription>
        </DialogHeader>
        <Select
          value={source ?? undefined}
          onValueChange={(v) => setSource(v as SourceType)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pick a source" />
          </SelectTrigger>
          <SelectContent>
            {BULK_SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                {sourceLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => source && onSubmit(source)} disabled={!source || busy}>
            {busy && <SpinnerIcon size={16} className="animate-spin" />}
            {busy ? "Adding…" : "Add source"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A competitor belongs to exactly one product, so this is a MOVE, not a set of
 * checkboxes: picking a product replaces the selection's membership. Only rendered
 * when the org has more than one product to move between.
 */
function MoveToProductDialog({
  open,
  onOpenChange,
  count,
  products,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  products: Array<{ id: string; name: string; isPrimary: boolean }>;
  busy: boolean;
  onSubmit: (productId: string, productName: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to product</DialogTitle>
          <DialogDescription>
            Pick which product tracks these{" "}
            <span className="tabular-nums">{count}</span> competitors from now on. Their
            signals move to that product&apos;s feed; signals already detected keep the
            product they were filed under.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-0.5">
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => onSubmit(p.id, p.name)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none transition-colors",
                "hover:bg-accent focus-visible:bg-accent disabled:opacity-60",
              )}
            >
              <span className="flex-1 truncate font-medium">{p.name}</span>
              {p.isPrimary && (
                <span className="text-meta text-muted-foreground">Primary</span>
              )}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
