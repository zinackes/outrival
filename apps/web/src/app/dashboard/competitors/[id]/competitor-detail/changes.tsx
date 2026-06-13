"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  ExternalLink,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { api, type ChangeRow } from "@/lib/api";
import { toastApiError } from "@/lib/error-helpers";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { eyebrowClass } from "@/components/outrival/eyebrow";
import { parseDiff } from "./helpers";

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
      toast.info("Classifying change with AI…", {
        description: "Refreshing in a few seconds.",
      });
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
        <span className="text-muted-foreground font-mono text-meta">
          · {formatDistanceToNow(new Date(change.detectedAt), { addSuffix: true })}
        </span>
        {pageUrl && (
          <a
            href={pageUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View page <ExternalLink size={12} />
          </a>
        )}
      </div>

      {hasSummary ? (
        <p className="text-sm leading-relaxed text-foreground">{summary}</p>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-dense text-muted-foreground italic">
            No AI summary yet — classification was never run for this change.
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
                <Loader2 size={11} className="animate-spin" /> Classifying…
              </>
            ) : (
              <>
                <Sparkles size={11} /> Classify with AI
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
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
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

function DiffPreview({ diffText }: { diffText: string }) {
  const { lines, truncated } = useMemo(() => parseDiff(diffText), [diffText]);
  if (lines.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        Only HTML/markup differences — nothing meaningful to display.
      </p>
    );
  }
  const added = lines.filter((l) => l.kind === "add").length;
  const removed = lines.filter((l) => l.kind === "remove").length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn("flex items-center gap-3", eyebrowClass("micro"))}>
        {added > 0 && <span className="text-positive">+ {added} added</span>}
        {removed > 0 && <span className="text-critical">− {removed} removed</span>}
      </div>
      <ul className="flex flex-col gap-1 text-dense leading-relaxed">
        {lines.map((l, i) => (
          <li
            key={i}
            className={cn(
              "px-2 py-1 rounded-sm font-normal flex gap-2",
              l.kind === "add" && "bg-positive/[0.08] text-foreground",
              l.kind === "remove" && "bg-critical/[0.08] text-foreground",
            )}
          >
            <span
              className={cn(
                "font-mono shrink-0 select-none",
                l.kind === "add" ? "text-positive" : "text-critical",
              )}
            >
              {l.kind === "add" ? "+" : "−"}
            </span>
            <span className="break-words min-w-0">{l.text}</span>
          </li>
        ))}
      </ul>
      {truncated && (
        <p className={eyebrowClass("micro")}>… more changes truncated</p>
      )}
    </div>
  );
}
