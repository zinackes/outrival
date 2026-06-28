"use client";

import { useQuery } from "@tanstack/react-query";
import { api, type SignalDetail } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { VisualDiff } from "@/components/outrival/visual-diff";
import { ChangeBreakdown } from "@/components/outrival/change-breakdown";

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="text-dense font-medium text-muted-foreground">{children}</div>
);

/**
 * Inline evidence dossier for the Signals master-detail right pane. Fetches the
 * user-safe signal detail (patch-14) and surfaces the WHAT changed below the
 * SignalCard — detected before/after, the before/after visual diff, and the typed
 * structured-change breakdown. This was previously buried behind the "Why this
 * insight?" modal; inlining it is what earns the detail pane its width.
 *
 * Best-effort: renders nothing while loading fails, or when the signal carries no
 * structured evidence (lexical / jobs / pricing signals) — the card stands alone.
 */
export function SignalEvidence({ signalId }: { signalId: string }) {
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

  // Nothing structured to show (lexical / pre-patch / non-homepage signals) — the
  // SignalCard already carries the full story; don't render an empty shell.
  if (!hasChange && !hasVisual && !hasChanges) return null;

  return (
    <div className="space-y-6 rounded-md border border-border bg-card p-5">
      {hasChange && (
        <section className="space-y-2.5">
          <Label>Key change</Label>
          <div className="grid grid-cols-[56px_1fr] items-baseline gap-x-4 gap-y-2">
            <span className="text-meta uppercase tracking-wide text-muted-foreground">
              Before
            </span>
            <span className="text-sm text-muted-foreground">
              {detail.humanChangeBefore ?? "—"}
            </span>
            <span className="text-meta uppercase tracking-wide text-muted-foreground">
              After
            </span>
            <span className="text-sm text-foreground">
              {detail.humanChangeAfter ?? "—"}
            </span>
          </div>
        </section>
      )}

      {hasVisual && (
        <section className="space-y-2.5">
          <Label>Visual change</Label>
          <VisualDiff signalId={signalId} />
        </section>
      )}

      {hasChanges && (
        <section className="space-y-3">
          <Label>All changes</Label>
          <ChangeBreakdown changes={detail.changes} />
        </section>
      )}
    </div>
  );
}
