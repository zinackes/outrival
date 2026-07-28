"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowSquareOutIcon } from "@/components/icons";
import { format } from "date-fns";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { sourceLabel } from "@/lib/source-labels";
import { GroupedChanges } from "@/components/outrival/change-breakdown";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { VisualDiff } from "@/components/outrival/visual-diff";

interface WhyInsightPanelProps {
  signalId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
    {children}
  </div>
);

/**
 * Progressive disclosure level 2 (patch-14): WHAT changed, WHERE it was seen, and
 * WHEN, in five seconds. No raw HTML, no AI classification, that lives in admin
 * tooling.
 *
 * Two columns, because stacked it ran to 1400px: the capture pair anchors the
 * left, the reading of it sits on the right. The grid row has a definite height
 * on desktop, so the change list scrolls inside its own column and opening a
 * folded group never resizes the dialog under the pointer. Without screenshots
 * (most sources) the grid drops to one column rather than leaving a lopsided gap.
 *
 * Falls back gracefully when the before/after couldn't be extracted (pre-patch
 * signals or a failed extraction).
 */
export function WhyInsightPanel({ signalId, open, onOpenChange }: WhyInsightPanelProps) {
  // The detail's screenshot flags are a pHash proxy, so the capture can still be
  // missing from R2. When that happens the section, its heading and the two-column
  // layout all go away — a "Visual change" title over nothing is worse than no
  // title at all.
  const [visualFailed, setVisualFailed] = useState(false);
  useEffect(() => setVisualFailed(false), [signalId]);

  // Fetch-on-open via useQuery.
  const detailQ = useQuery({
    queryKey: ["signalDetail", signalId],
    queryFn: () => api.getSignalDetail(signalId).then((r) => r.signal),
    enabled: open,
  });
  const detail = detailQ.data ?? null;
  const state: "idle" | "loading" | "error" = detailQ.isError
    ? "error"
    : detailQ.isFetching
      ? "loading"
      : "idle";

  const hasChange = Boolean(detail?.humanChangeBefore || detail?.humanChangeAfter);
  const hasVisual =
    Boolean(detail?.screenshots?.before && detail?.screenshots?.after) &&
    !visualFailed;
  const changes = detail?.changes ?? [];
  const majorCount = changes.filter((c) => c.significance === "major").length;
  const host = hostOf(detail?.sourceUrl ?? null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(hasVisual ? "max-w-[880px]" : "max-w-xl")}>
        <DialogHeader>
          <DialogTitle className="text-base">Why this insight?</DialogTitle>
          <DialogDescription>
            {detail ? (
              <>
                {sourceLabel(detail.sourceType)} of {detail.competitor.name}, seen on{" "}
                {format(new Date(detail.detectedAt), "MMM d 'at' HH:mm")}
                {detail.sourceUrl && (
                  <>
                    {" · "}
                    <a
                      href={detail.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-sm text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {host ?? "Open the live page"}
                      <ArrowSquareOutIcon size={16} aria-hidden />
                    </a>
                  </>
                )}
              </>
            ) : (
              "Where this signal came from and what changed."
            )}
          </DialogDescription>
        </DialogHeader>

        {state === "loading" && (
          <div className="space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
          </div>
        )}

        {state === "error" && (
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load the details right now. Close this and try again
            in a moment.
          </p>
        )}

        {state === "idle" && detail && (
          <div
            className={cn(
              "grid gap-x-8 gap-y-6",
              // The definite height is desktop-only and only when there is a
              // capture to anchor it: on a phone the dialog scrolls as one
              // document, and without screenshots the column is short anyway.
              hasVisual && "md:h-[440px] md:grid-cols-[1fr_330px]",
            )}
          >
            {hasVisual && (
              <section className="flex min-h-0 flex-col gap-2.5">
                <SectionLabel>Visual change</SectionLabel>
                <VisualDiff
                  signalId={signalId}
                  fill
                  onUnavailable={() => setVisualFailed(true)}
                />
              </section>
            )}

            <section className="flex min-h-0 flex-col">
              <SectionLabel>Key change</SectionLabel>
              {hasChange ? (
                <div className="mt-2.5 grid grid-cols-[52px_1fr] items-baseline gap-x-4 gap-y-1.5">
                  <span className="text-meta uppercase tracking-wide text-muted-foreground">
                    Before
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {detail.humanChangeBefore ?? "Not captured"}
                  </span>
                  <span className="text-meta uppercase tracking-wide text-muted-foreground">
                    After
                  </span>
                  <span className="text-sm text-foreground">
                    {detail.humanChangeAfter ?? "Not captured"}
                  </span>
                </div>
              ) : (
                <p className="mt-2.5 text-sm text-muted-foreground">
                  We compared the page against its previous capture. The change
                  was in the page text, so there is no field-level pair to show.
                </p>
              )}

              {changes.length > 0 && (
                <>
                  <div className="mt-6 flex items-baseline gap-3 border-b border-border pb-2">
                    <SectionLabel>All changes</SectionLabel>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {changes.length} total, {majorCount} major
                    </span>
                  </div>
                  {/* Scrolls inside the column so the dialog holds its size when
                      a folded group opens. */}
                  <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-2">
                    <GroupedChanges changes={changes} />
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
