"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ArrowSquareOutIcon, CaretDownIcon, CaretRightIcon } from "@/components/icons";
import type { ChangeRow } from "@/lib/api";
import { noSummaryReason, reviewCaptureLine } from "@/lib/change-fallback";
import { Badge } from "@/components/ui/badge";
import { DiffPreview } from "@/components/outrival/diff-preview";

export function ChangeCard({
  change,
  fallbackUrl,
  insight,
}: {
  change: ChangeRow;
  fallbackUrl?: string;
  insight?: string | null;
}) {
  // Prefer the strategic signal insight (when this change became a signal) over
  // the change's own classification summary.
  const summary = insight && insight.trim().length > 0 ? insight : change.summary;
  const hasSummary = !!summary && summary.trim().length > 0;
  const capture = change.reviewCapture ?? null;
  // A change with no summary still has its diff, and that is the content: it
  // opens with the card rather than sitting behind a toggle the reader has no
  // reason to press. Review captures are the exception — their "diff" is the
  // whole rotated list, tens of thousands of characters of other people's
  // reviews, which is exactly what the capture line replaces.
  const [open, setOpen] = useState(!hasSummary && change.suppressionReason !== "rotating_list");

  const pageUrl = change.monitorUrl ?? fallbackUrl ?? null;
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 mb-2 text-xs">
        <Badge variant="outline" className="text-meta uppercase tracking-wide font-medium px-2 py-0">
          {change.sourceType}
        </Badge>
        <span className="text-muted-foreground text-meta">
          · {formatDistanceToNow(new Date(change.detectedAt), { addSuffix: true })}
        </span>
        {pageUrl && (
          <a
            href={pageUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View page <ArrowSquareOutIcon size={14} />
          </a>
        )}
      </div>

      {hasSummary ? (
        <p className="text-sm leading-relaxed text-foreground">{summary}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {capture && (
            <p className="text-sm leading-relaxed tabular-nums text-foreground">
              {reviewCaptureLine(capture)}
            </p>
          )}
          <p className="text-dense text-muted-foreground">
            {noSummaryReason(change.suppressionReason)}
          </p>
        </div>
      )}

      {change.diffText && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {open ? <CaretDownIcon size={14} /> : <CaretRightIcon size={14} />}
            {open ? "Hide raw diff" : "Show raw diff"}
          </button>
          {open && (
            <div className="mt-2 pt-2 border-t border-border/50">
              <DiffPreview diffText={change.diffText} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
