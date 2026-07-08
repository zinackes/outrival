"use client";

import {
  OctagonAlert,
  TriangleAlert,
  AlertCircle,
  ArrowDownRight,
  Layers,
  Archive,
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
 * carry a left accent rail + dot. Selection is a background tint (no bar).
 */
export function SignalRow({
  signal,
  selected,
  onSelect,
  tabStop = false,
  onFocus,
  selecting = false,
}: {
  signal: Signal;
  selected: boolean;
  onSelect: () => void;
  // Roving tabindex: exactly one row in the listbox is the Tab entry point (0);
  // the rest are -1 (still programmatically focusable by the arrow/j-k handler).
  tabStop?: boolean;
  onFocus?: () => void;
  // The selection checkbox occupies this row's severity-icon slot (row hover, or a
  // live selection). Fade the icon out underneath so the two never overlap — the
  // slot is reused instead of reserving a permanent empty gutter left of the list.
  selecting?: boolean;
}) {
  const sev = signal.severityOverride ?? signal.severity;
  const Icon = SEV_ICON[sev];
  const unread = !signal.isRead;

  return (
    <button
      type="button"
      id={`row-${signal.id}`}
      tabIndex={tabStop ? 0 : -1}
      role="option"
      aria-selected={selected}
      onFocus={onFocus}
      onClick={onSelect}
      className={cn(
        "group relative grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-2.5 rounded-md px-3 py-2.5 text-left outline-none transition-colors",
        // Unread rail as an inset pill (before:) so it floats inside the row and
        // never collides with the list's rounded corners on the first/last item.
        // Selection is a background tint only — the rail now flags unread, not
        // selection (a left-edge cue reads far more than the trailing dot alone).
        "before:absolute before:inset-y-2 before:left-1 before:w-0.5 before:rounded-full before:transition-colors before:content-['']",
        unread ? "before:bg-primary" : "before:bg-transparent",
        selected ? "bg-accent" : "hover:bg-accent/50 focus-visible:bg-accent/50",
      )}
    >
      <Icon
        size={15}
        className={cn(
          "mt-0.5 shrink-0 transition-opacity group-hover/row:opacity-0",
          selecting && "opacity-0",
          SEV_TEXT[sev],
        )}
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
          {/* L2 provenance marker — this row was reconstructed from the web archive. */}
          {signal.filteredReason === "backfill" && (
            <Archive
              size={12}
              className="shrink-0 text-muted-foreground"
              aria-label="From archive"
            />
          )}
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
        <time className="text-meta text-muted-foreground tabular-nums">
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
  tabStop = false,
  onFocus,
}: {
  batchId: string;
  signals: Signal[];
  summary: string | null;
  selected: boolean;
  onSelect: () => void;
  tabStop?: boolean;
  onFocus?: () => void;
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
      tabIndex={tabStop ? 0 : -1}
      role="option"
      aria-selected={selected}
      onFocus={onFocus}
      onClick={onSelect}
      className={cn(
        "group relative grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-2.5 rounded-md px-3 py-2.5 text-left outline-none transition-colors",
        // Unread rail as an inset pill (before:) so it floats inside the row and
        // never collides with the list's rounded corners on the first/last item.
        // Selection is a background tint only — the rail now flags unread, not
        // selection (a left-edge cue reads far more than the trailing dot alone).
        "before:absolute before:inset-y-2 before:left-1 before:w-0.5 before:rounded-full before:transition-colors before:content-['']",
        unread ? "before:bg-primary" : "before:bg-transparent",
        selected ? "bg-accent" : "hover:bg-accent/50 focus-visible:bg-accent/50",
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
        <time className="text-meta text-muted-foreground tabular-nums">
          {formatDistanceToNow(new Date(first.createdAt), { addSuffix: false })}
        </time>
        {unread && (
          <span className="size-1.5 rounded-full bg-primary" aria-label="Unread" />
        )}
      </span>
    </button>
  );
}
