"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowSquareOutIcon,
  SpinnerIcon,
  SparkleIcon,
  CaretDownIcon,
  CaretRightIcon,
} from "@/components/icons";
import { api, type ChangeRow } from "@/lib/api";
import { toastApiError } from "@/lib/error-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DiffPreview } from "@/components/outrival/diff-preview";

export function ChangeCard({
  change,
  onRefresh,
  fallbackUrl,
  insight,
}: {
  change: ChangeRow;
  onRefresh?: () => void;
  fallbackUrl?: string;
  insight?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [classifying, setClassifying] = useState(false);
  // Prefer the strategic signal insight (when this change became a signal) over
  // the change's own classification summary.
  const summary = insight && insight.trim().length > 0 ? insight : change.summary;
  const hasSummary = !!summary && summary.trim().length > 0;

  async function classify() {
    setClassifying(true);
    try {
      await api.classifyChange(change.id);
      setTimeout(() => {
        onRefresh?.();
        setClassifying(false);
      }, 4000);
    } catch (e) {
      toastApiError(e, { title: "Couldn't classify that change" });
      setClassifying(false);
    }
  }

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
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-dense text-muted-foreground italic">
            No AI summary yet. Classification was never run for this change.
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={classifying}
            onClick={classify}
            className="h-7 text-xs"
          >
            {classifying ? (
              <>
                <SpinnerIcon size={16} className="animate-spin" /> Classifying…
              </>
            ) : (
              <>
                <SparkleIcon size={16} /> Classify with AI
              </>
            )}
          </Button>
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

