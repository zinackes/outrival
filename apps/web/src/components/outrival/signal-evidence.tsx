"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, CornerDownRight } from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { VisualDiff } from "@/components/outrival/visual-diff";
import { ChangeBreakdown } from "@/components/outrival/change-breakdown";
import { cn } from "@/lib/utils";

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="text-dense font-medium text-muted-foreground">{children}</div>
);

/**
 * Inline evidence dossier for the Signals master-detail right pane. Fetches the
 * user-safe signal detail (patch-14) and surfaces the WHAT changed below the
 * SignalCard — the single headline before/after, the before/after visual diff,
 * and the typed structured-change breakdown (folded by default).
 *
 * The before/after is bounded (line-clamp) and the full change list is behind a
 * disclosure: the evidence is the trust surface, but it must not bury the card
 * under a wall of raw text. A pre-fix classification could dump a paragraph (or
 * several concatenated changes) into humanChangeAfter; the clamp keeps existing
 * signals readable while the tightened prompt fixes new ones.
 *
 * Best-effort: renders nothing while loading fails, or when the signal carries no
 * structured evidence (lexical / jobs / pricing signals) — the card stands alone.
 */
export function SignalEvidence({ signalId }: { signalId: string }) {
  const [showAll, setShowAll] = useState(false);
  // Shares the ["signalDetail", id] cache with the "Why this insight?" panel.
  const detailQ = useQuery({
    queryKey: ["signalDetail", signalId],
    queryFn: () => api.getSignalDetail(signalId).then((r) => r.signal),
  });
  const detail = detailQ.data ?? null;
  const state: "loading" | "error" | "idle" = detailQ.isError
    ? "error"
    : detailQ.isFetching
      ? "loading"
      : "idle";

  if (state === "loading") {
    return (
      <div className="space-y-2.5 rounded-md border border-border bg-card p-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (state === "error" || !detail) return null;

  const hasChange = Boolean(detail.humanChangeBefore || detail.humanChangeAfter);
  const hasVisual = Boolean(detail.screenshots?.before && detail.screenshots?.after);
  const hasChanges = detail.changes.length > 0;
  // A headline before/after or a visual diff already summarizes the change, so the
  // typed breakdown can stay folded. Without either, the breakdown IS the summary —
  // show it open, no toggle.
  const hasSummary = hasChange || hasVisual;

  // Nothing structured to show (lexical / pre-patch / non-homepage signals) — the
  // SignalCard already carries the full story; don't render an empty shell.
  if (!hasChange && !hasVisual && !hasChanges) return null;

  return (
    <div className="space-y-5 rounded-md border border-border bg-card p-5">
      {hasChange && (
        <section className="space-y-2">
          <Label>What changed</Label>
          <div className="space-y-1 text-sm">
            {detail.humanChangeBefore && (
              <p className="line-clamp-2 text-muted-foreground">
                {detail.humanChangeBefore}
              </p>
            )}
            {detail.humanChangeAfter && (
              <p className="flex gap-1.5 text-foreground">
                <CornerDownRight
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="line-clamp-2">{detail.humanChangeAfter}</span>
              </p>
            )}
          </div>
        </section>
      )}

      {hasVisual && (
        <section className="space-y-2.5">
          <Label>Visual change</Label>
          <VisualDiff signalId={signalId} />
        </section>
      )}

      {hasChanges &&
        (hasSummary ? (
          <section className="space-y-3">
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="flex items-center gap-1.5 text-dense font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
            >
              {showAll ? "Hide" : "Show all"} {detail.changes.length} change
              {detail.changes.length === 1 ? "" : "s"}
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  showAll && "rotate-180",
                )}
                aria-hidden
              />
            </button>
            {showAll && <ChangeBreakdown changes={detail.changes} />}
          </section>
        ) : (
          <section className="space-y-3">
            <Label>Changes</Label>
            <ChangeBreakdown changes={detail.changes} />
          </section>
        ))}
    </div>
  );
}
