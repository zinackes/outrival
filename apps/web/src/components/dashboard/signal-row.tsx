"use client";

import { StackIcon, ArchiveIcon } from "@/components/icons";
import { formatDistanceToNow } from "date-fns";
import type { Signal } from "@/lib/api";
import { cn } from "@/lib/utils";
import { shortAge } from "@/lib/format-date";
import { sourceLabel } from "@/lib/source-labels";
import { competitorNameColor } from "@/lib/competitor-color";
import { SeverityGauge } from "@/components/outrival/severity-scale";
import { CatText } from "./cat-pill";

type Sev = Signal["severity"];

const SEV_TEXT: Record<Sev, string> = {
  critical: "text-critical",
  high: "text-high",
  medium: "text-medium",
  low: "text-muted-foreground",
};
const SEV_RANK: Record<Sev, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/**
 * One compact row in the Signals master list (Linear/Sentry inbox register). The
 * detail lives in the right pane; this stays scannable — the finding leads, and
 * who moved / from where sits under it as attribution. Read rows dim; unread
 * carry a bold title + trailing dot. Selection is a background tint (no bar).
 *
 * Severity is the SeverityGauge — the same four bands the detail pane shows, so
 * the encoding is learned once. It replaced a set of four alert icons whose
 * shapes (octagon/triangle/circle/arrow) were arbitrary, which left color doing
 * the work alone and made a routine copy change wear an incident's chrome.
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
  // The selection checkbox occupies this row's severity slot (row hover, or a live
  // selection). Fade the gauge out underneath so the two never overlap — the slot
  // is reused instead of reserving a permanent empty gutter left of the list.
  selecting?: boolean;
}) {
  const sev = signal.severityOverride ?? signal.severity;
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
        // No unread rail: the gauge owns the gutter now, and a second thin
        // vertical 6px to its left stuttered. Unread reads from the title (bold,
        // full-contrast, against a read row's muted medium) plus the trailing dot.
        selected ? "bg-accent" : "hover:bg-accent/50 focus-visible:bg-accent/50",
      )}
    >
      <SeverityGauge
        severity={sev}
        className={cn(
          // Fade out only on hover-capable devices — paired with the checkbox
          // reveal, which is gated the same way (see signals-view renderRow). On
          // touch the gauge must stay, since no checkbox slides in to replace it.
          "mt-0.5 shrink-0 transition-opacity [@media(hover:hover)]:group-hover/row:opacity-0",
          selecting && "opacity-0",
        )}
      />

      <span className="min-w-0">
        {/* The finding leads: it's what the reader is scanning for. */}
        <span
          className={cn(
            "block truncate text-dense leading-snug",
            unread
              ? "font-semibold text-foreground"
              : "font-medium text-muted-foreground",
          )}
        >
          {signal.insight}
        </span>
        {/* Where we caught it. The competitor is NOT repeated here: the insight
            opens with its name (the model writes it from the context it's given),
            and it opens the line, so truncation never eats it. */}
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
          <span className="truncate">{sourceLabel(signal.sourceType)}</span>
          <span aria-hidden>·</span>
          <CatText category={signal.category} />
          {/* L2 provenance marker — this row was reconstructed from the web archive. */}
          {signal.filteredReason === "backfill" && (
            <ArchiveIcon
              size={14}
              className="shrink-0"
              aria-label="From archive"
            />
          )}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-2 pt-0.5">
        <time
          className="text-meta text-muted-foreground tabular-nums"
          dateTime={signal.createdAt}
          title={formatDistanceToNow(new Date(signal.createdAt), {
            addSuffix: true,
          })}
        >
          {shortAge(signal.createdAt)}
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
      <StackIcon
        size={16}
        className={cn("mt-0.5 shrink-0", SEV_TEXT[maxSev])}
        aria-label={`${maxSev} severity batch`}
      />
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate text-dense leading-snug",
            unread
              ? "font-semibold text-foreground"
              : "font-medium text-muted-foreground",
          )}
        >
          {summary ?? `${signals.length} similar ${first.category} signals`}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
          <span
            className="truncate font-medium"
            style={competitorNameColor(first.competitorColor)}
          >
            {first.competitorName}
          </span>
          <span aria-hidden>·</span>
          <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 tabular-nums">
            {signals.length}
          </span>
          <span className="truncate">grouped</span>
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
