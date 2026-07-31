"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SpinnerIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { competitorPriorityQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** "https://linear.app/pricing" → "linear.app". Falls back to the raw string. */
function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Picks which competitors stay monitored when the plan's cap is smaller than the
 * roster. Used in two places: inside the plan-switch confirmation (the cap of the
 * plan being switched TO), and standalone from the over-limit notice.
 *
 * The choice is saved by `onConfirm`, not here, so the switch flow can write the
 * selection and change the plan as one action the user confirmed once.
 */
export function CompetitorPriorityDialog({
  open,
  onOpenChange,
  limit,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Competitor cap of the plan this selection applies to. */
  limit: number;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (keep: string[]) => Promise<void>;
}) {
  const rosterQ = useQuery({ ...competitorPriorityQuery(), enabled: open });
  const rosterData = rosterQ.data?.competitors;
  const roster = rosterData ?? [];
  const [keep, setKeep] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the selection from the roster's current cap order (the server already ranks
  // prioritised-first, oldest-next), so opening the dialog and confirming without
  // touching anything keeps exactly what was already monitored instead of
  // re-shuffling it. Cleared on close so a cancelled edit never leaks into the next
  // open — and so a cap that changed in between re-seeds against the new one.
  useEffect(() => {
    if (!open) {
      setKeep(null);
      setError(null);
      return;
    }
    if (!rosterData) return;
    setKeep((prev) => prev ?? rosterData.slice(0, limit).map((comp) => comp.id));
  }, [open, rosterData, limit]);

  const selected = keep ?? [];
  const target = Math.min(limit, roster.length);
  const atCap = selected.length >= limit;

  function toggle(id: string) {
    setKeep((prev) => {
      const current = prev ?? [];
      if (current.includes(id)) return current.filter((x) => x !== id);
      if (current.length >= limit) return current;
      return [...current, id];
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(selected);
    } catch (e) {
      setError(String(e));
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-foreground">Keep monitoring</span>
          <span
            className={cn(
              "text-xs tabular-nums",
              selected.length === target ? "text-muted-foreground" : "text-high",
            )}
          >
            {selected.length} of {target} selected
          </span>
        </div>

        <div className="-mx-1 max-h-72 overflow-y-auto rounded-md border border-border">
          {rosterQ.isPending ? (
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : rosterQ.isError ? (
            <p className="p-3 text-sm text-muted-foreground">
              Couldn&apos;t load your competitors.{" "}
              <button
                type="button"
                onClick={() => void rosterQ.refetch()}
                className="text-link underline underline-offset-2"
              >
                Retry
              </button>
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {roster.map((comp) => {
                const isKept = selected.includes(comp.id);
                const host = hostOf(comp.url);
                // Unchecking is always allowed; checking stops at the cap, so the
                // disabled state only ever blocks going over it.
                const locked = !isKept && atCap;
                return (
                  <li key={comp.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40",
                        locked && "cursor-not-allowed opacity-45 hover:bg-transparent",
                      )}
                    >
                      <Checkbox
                        checked={isKept}
                        disabled={locked || busy}
                        onCheckedChange={() => toggle(comp.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-dense text-foreground">
                          {comp.name}
                        </span>
                        {host && (
                          <span className="block truncate text-meta text-muted-foreground">
                            {host}
                          </span>
                        )}
                      </span>
                      {!isKept && (
                        <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-meta text-muted-foreground">
                          Paused
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Paused competitors keep their history and stop being scanned. Nothing is
          deleted, and they resume as soon as you free up a slot or upgrade.
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={submit}
            disabled={busy || rosterQ.isPending || selected.length !== target}
          >
            {busy && <SpinnerIcon size={16} className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
