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
import { CatPill } from "./cat-pill";

type Sev = Signal["severity"];

// Severity icon — the non-color encoding (shape differs per level), so severity
// reads without relying on color alone. It is now the row's only severity cue:
// the former filled SEVERITY badge + colored left rail are dropped to keep the
// list quiet (they stacked four colored elements per row, reading as "AI slop").
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
const SEV_RANK: Record<Sev, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/**
 * One compact row in the Signals master list (Linear/Sentry inbox register). The
 * detail lives in the right pane; this stays scannable — a severity icon, who
 * moved, the category, the one-line finding, and the age. Read rows dim; unread
 * carry a dot. Selection (a neutral left bar + tint) drives the detail pane.
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
        "group relative grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-2.5 rounded-md px-3 py-2.5 text-left outline-none transition-colors",
        // Selection bar as an inset pill (before:) so it floats inside the row and
        // never collides with the list's rounded corners on the first/last item.
        "before:absolute before:inset-y-2 before:left-1 before:w-0.5 before:rounded-full before:transition-colors before:content-['']",
        selected
          ? "bg-accent before:bg-foreground/55"
          : "hover:bg-accent/50 focus-visible:bg-accent/50 before:bg-transparent",
      )}
    >
      <Icon
        size={15}
        className={cn("mt-0.5 shrink-0", SEV_TEXT[sev])}
        aria-label={`${sev} severity`}
      />

      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
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
        "group relative grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-2.5 rounded-md px-3 py-2.5 text-left outline-none transition-colors",
        // Selection bar as an inset pill (before:) so it floats inside the row and
        // never collides with the list's rounded corners on the first/last item.
        "before:absolute before:inset-y-2 before:left-1 before:w-0.5 before:rounded-full before:transition-colors before:content-['']",
        selected
          ? "bg-accent before:bg-foreground/55"
          : "hover:bg-accent/50 focus-visible:bg-accent/50 before:bg-transparent",
      )}
    >
      <Layers
        size={15}
        className={cn("mt-0.5 shrink-0", SEV_TEXT[maxSev])}
        aria-label={`${maxSev} severity batch`}
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
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
