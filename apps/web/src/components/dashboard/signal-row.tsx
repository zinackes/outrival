"use client";

import {
  OctagonAlert,
  TriangleAlert,
  AlertCircle,
  ArrowDownRight,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Signal } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "./severity-pill";
import { CatPill } from "./cat-pill";

type Sev = Signal["severity"];

// Severity icon — the redundant non-color encoding (brief: icon + label + color,
// never color alone). Paired with the colored left rail and the SeverityBadge.
const SEV_ICON: Record<Sev, LucideIcon> = {
  critical: OctagonAlert,
  high: TriangleAlert,
  medium: AlertCircle,
  low: ArrowDownRight,
};
const SEV_TEXT: Record<Sev, string> = {
  critical: "text-critical",
  high: "text-high",
  medium: "text-medium",
  low: "text-muted-foreground",
};
const SEV_RAIL: Record<Sev, string> = {
  critical: "border-l-critical",
  high: "border-l-high",
  medium: "border-l-medium",
  low: "border-l-muted-foreground/40",
};
const SEV_RANK: Record<Sev, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/**
 * One compact row in the Signals master list (Linear/Sentry inbox register). The
 * detail lives in the right pane; this stays scannable — a colored severity rail,
 * the severity icon + badge, who moved, the one-line finding, and the age. Read
 * rows dim; unread carry a dot. Selection drives the detail pane.
 */
export function SignalRow({
  signal,
  selected,
  onSelect,
}: {
  signal: Signal;
  selected: boolean;
  onSelect: () => void;
}) {
  const sev = signal.severityOverride ?? signal.severity;
  const Icon = SEV_ICON[sev];
  const unread = !signal.isRead;

  return (
    <button
      type="button"
      id={`row-${signal.id}`}
      tabIndex={-1}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "group grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-2.5 border-l-2 px-3 py-2.5 text-left outline-none transition-colors",
        SEV_RAIL[sev],
        selected
          ? "bg-accent"
          : "border-l-transparent hover:bg-accent/40 focus-visible:bg-accent/40",
      )}
    >
      <Icon
        size={15}
        className={cn("mt-0.5 shrink-0", SEV_TEXT[sev])}
        aria-label={`${sev} severity`}
      />

      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <SeverityBadge severity={sev} />
          <span
            className={cn(
              "truncate text-dense font-semibold",
              unread ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {signal.competitorName}
          </span>
          <CatPill size="compact">{signal.category}</CatPill>
        </span>
        <span
          className={cn(
            "mt-1 block truncate text-dense leading-snug",
            unread ? "text-foreground/90" : "text-muted-foreground",
          )}
        >
          {signal.insight}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-2 pt-0.5">
        <time className="font-mono text-meta text-muted-foreground tabular-nums">
          {formatDistanceToNow(new Date(signal.createdAt), { addSuffix: false })}
        </time>
        {unread && (
          <span
            className="size-1.5 rounded-full bg-primary"
            aria-label="Unread"
          />
        )}
      </span>
    </button>
  );
}

/**
 * A batch of similar signals (patch-26) shown as one selectable row. Selecting it
 * opens the group (summary + members) in the detail pane — noise stays collapsed
 * in the list, unlike inline expansion.
 */
export function BatchRow({
  batchId,
  signals,
  summary,
  selected,
  onSelect,
}: {
  batchId: string;
  signals: Signal[];
  summary: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const first = signals[0]!;
  const maxSev = signals.reduce<Sev>(
    (m, s) => (SEV_RANK[s.severity] > SEV_RANK[m] ? s.severity : m),
    "low",
  );
  const unread = signals.some((s) => !s.isRead);

  return (
    <button
      type="button"
      id={`row-batch-${batchId}`}
      tabIndex={-1}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "group grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-2.5 border-l-2 px-3 py-2.5 text-left outline-none transition-colors",
        SEV_RAIL[maxSev],
        selected
          ? "bg-accent"
          : "border-l-transparent hover:bg-accent/40 focus-visible:bg-accent/40",
      )}
    >
      <Layers
        size={15}
        className={cn("mt-0.5 shrink-0", SEV_TEXT[maxSev])}
        aria-label={`${maxSev} severity batch`}
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <SeverityBadge severity={maxSev} />
          <span
            className={cn(
              "truncate text-dense font-semibold",
              unread ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {first.competitorName}
          </span>
          <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 font-mono text-meta text-muted-foreground tabular-nums">
            {signals.length}
          </span>
        </span>
        <span className="mt-1 block truncate text-dense leading-snug text-muted-foreground">
          {summary ?? `${signals.length} similar ${first.category} signals`}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 pt-0.5">
        <time className="font-mono text-meta text-muted-foreground tabular-nums">
          {formatDistanceToNow(new Date(first.createdAt), { addSuffix: false })}
        </time>
        {unread && (
          <span className="size-1.5 rounded-full bg-primary" aria-label="Unread" />
        )}
      </span>
    </button>
  );
}
