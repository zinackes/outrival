"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowSquareOutIcon } from "@/components/icons";
import { format } from "date-fns";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { sourceLabel } from "@/lib/source-labels";
import { GroupedChanges } from "@/components/outrival/change-breakdown";
import { DiffPreview } from "@/components/outrival/diff-preview";
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

const SectionLabel = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "text-xs font-semibold uppercase tracking-wide text-muted-foreground",
      className,
    )}
  >
    {children}
  </div>
);

// The three axes, in the order they are applied: the two that set the band, then
// the one that modulates it. Each gloss says what the number MEANT, since the
// number itself is on screen next to it.
const MATERIALITY_AXES = [
  {
    key: "decisionImpact" as const,
    label: "Decision impact",
    gloss: "Would this change how you price, position or sell?",
  },
  {
    key: "urgency" as const,
    label: "Urgency",
    gloss: "React within days, or read it in Monday's digest?",
  },
  {
    key: "corroboration" as const,
    label: "Corroboration",
    gloss: "How many of their surfaces independently show it.",
  },
];

/**
 * The severity band, explained by the numbers it was computed from.
 *
 * The band is a deterministic function of these three scores, so this is not a
 * paraphrase of a model's reasoning, it is the reasoning. Without it the panel
 * stated a verdict and, next to the feed's threat meter, two different-looking
 * verdicts ("Medium" beside "Low threat") with no way to reconcile them.
 *
 * Four ticks per axis, matching SeverityScale: the scores are positions on a
 * 0-to-3 scale, not magnitudes, and the two instruments must read as one system.
 */
function MaterialityReadout({
  scores,
}: {
  scores: { decisionImpact: number; urgency: number; corroboration: number; explanation: string };
}) {
  return (
    <div className="mt-2.5 space-y-2.5">
      {MATERIALITY_AXES.map((axis) => {
        const value = scores[axis.key];
        return (
          <div key={axis.key} className="flex items-baseline gap-3">
            <span
              role="img"
              aria-label={`${axis.label} ${value} of 3`}
              className="flex shrink-0 items-center gap-[3px] pt-0.5"
            >
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={cn(
                    "h-3.5 w-1 rounded-sm",
                    i <= value ? "bg-foreground" : "bg-border-strong",
                  )}
                  aria-hidden
                />
              ))}
            </span>
            <span className="min-w-0">
              <span className="text-sm text-foreground">{axis.label}</span>
              <span className="ml-2 text-xs tabular-nums text-muted-foreground">
                {value}/3
              </span>
              <span className="block text-xs text-muted-foreground">{axis.gloss}</span>
            </span>
          </div>
        );
      })}
      <p className="border-t border-border pt-2.5 text-sm leading-relaxed text-muted-foreground">
        {scores.explanation}
      </p>
    </div>
  );
}

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
                  beforeCapturedAt={detail.screenshots?.beforeCapturedAt}
                  afterCapturedAt={detail.screenshots?.afterCapturedAt}
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
              ) : detail.diffText ? (
                // The pair is null whenever the change is a SET rather than one
                // value, which is most sources. The lines the page added and
                // removed answer the same question without pretending the change
                // had two sides.
                <div className="mt-2.5">
                  <DiffPreview diffText={detail.diffText} maxLines={12} />
                </div>
              ) : (
                <p className="mt-2.5 text-sm text-muted-foreground">
                  We compared the page against its previous capture. The change
                  was in the page text, so there is no field-level pair to show.
                </p>
              )}

              {detail.materiality && (
                <>
                  <SectionLabel className="mt-6">Why this severity</SectionLabel>
                  <MaterialityReadout scores={detail.materiality} />
                </>
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
