"use client";

import { StackIcon, ArchiveIcon, CaretDownIcon } from "@/components/icons";
import { formatDistanceToNow } from "date-fns";
import type { Signal } from "@/lib/api";
import { cn } from "@/lib/utils";
import { shortAge } from "@/lib/format-date";
import { signalTitle } from "@/lib/signal-shape";
import { sourceLabel } from "@/lib/source-labels";
import { competitorNameColor } from "@/lib/competitor-color";
import { SeverityGauge } from "@/components/outrival/severity-scale";
import { CompAvatar } from "./comp-avatar";
import { CatText, catLabel } from "./cat-pill";

type Sev = Signal["severity"];

const SEV_RANK: Record<Sev, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/**
 * One compact row in the Signals master list (Linear/Sentry inbox register). The
 * detail lives in the right pane; this stays scannable — the finding leads, and
 * who moved / from where sits under it as attribution. Read rows dim; unread
 * carry a bold title + trailing dot. Selection is a background tint (no bar).
 *
 * The row carries the insight's TITLE, not the insight (signalTitle): the model
 * writes a paragraph, and fifty unread paragraphs is what made the list the
 * opposite of the brief it summarises. The paragraph itself is one press away,
 * in the pane. Under it sits the signal's "so what" — the same one line per item
 * the brief gives, which is the sentence a reader triages on.
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
  showCompetitor = true,
}: {
  signal: Signal;
  selected: boolean;
  onSelect: () => void;
  // Roving tabindex: exactly one row in the listbox is the Tab entry point (0);
  // the rest are -1 (still programmatically focusable by the arrow/j-k handler).
  tabStop?: boolean;
  onFocus?: () => void;
  // The selection checkbox occupies this row's avatar slot (row hover, or a live
  // selection). Fade the avatar out underneath so the two never overlap — the slot
  // is reused instead of reserving a permanent empty gutter left of the list.
  selecting?: boolean;
  // Off when a competitor heading already stands over this row (the default
  // grouping nests rows under one). The title no longer opens with the name —
  // signalTitle strips it — so ungrouped, the meta line is where it lives.
  showCompetitor?: boolean;
}) {
  const sev = signal.severityOverride ?? signal.severity;
  const unread = !signal.isRead;
  const title = signalTitle(signal);

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
      {/* Gutter: whose move it is, then the band. The insight opens with the
          competitor's name, but that is prose — it starts at a different word on
          every row, so it never forms a column you can scan. The mark does, and
          it is the same one the roster, the compare view and the battle card use,
          so identity is learned once.
          Stacked rather than side by side: the mark leads the row and the band
          reads as the verdict UNDER it, which is the order the reader wants (who
          moved, then how much to care). Abreast, the 10px gauge came first and
          pushed the mark off the list's leading edge, so the one column worth
          scanning didn't start where the eye lands. The stack is 37px, the same
          height as the two lines of text beside it, so the row doesn't grow.
          The checkbox takes the AVATAR's slot, not the gauge's (see signals-view
          renderRow): severity is the reason a row is worth reading, and it used
          to blank out on plain hover — the one moment the reader is aiming at
          that row. Identity is what yields instead, which is also the swap every
          mail client makes when a list enters selection. */}
      <span className="flex shrink-0 flex-col items-center gap-1">
        <span
          className={cn(
            // Fade only on hover-capable devices — paired with the checkbox
            // reveal, which is gated the same way. On touch the avatar must stay,
            // since no checkbox slides in to replace it.
            "transition-opacity [@media(hover:hover)]:group-hover/row:opacity-0",
            selecting && "opacity-0",
          )}
        >
          <CompAvatar
            name={signal.competitorName}
            url={signal.competitorUrl}
            size={18}
          />
        </span>
        <SeverityGauge severity={sev} />
      </span>

      <span className="min-w-0">
        {/* The read state, in the row's ACCESSIBLE NAME. It used to be an
            aria-label on the trailing dot's span, which is not an interactive or
            labellable element — so it was dropped, and a screen-reader user had
            no read state at all. Inside the button's content it lands in the
            name, first, the way the dot lands first for a sighted reader. */}
        {unread && <span className="sr-only">Unread. </span>}
        {/* The finding leads: it's what the reader is scanning for. */}
        <span
          className={cn(
            // 700 against 400 — the widest step the family gives. At 600/500 the
            // two rows were one notch apart and a 62-item backlog read as one
            // uniform block, which is what the audit measured.
            "block truncate text-dense leading-snug",
            unread
              ? "font-bold text-foreground"
              : "font-normal text-muted-foreground",
          )}
        >
          {title}
        </span>
        {/* Why it matters — the sentence the reader actually triages on, so it
            gets two lines. At one it cut mid-clause ("The removed claim does
            not ove…"): an excerpt with the conclusion missing, which forced the
            reader to open every signal to sort it. Two lines is still a bound,
            not the paragraph the title bought us out of — a short so-what keeps
            the row at 77px, a long one grows it to 95. */}
        {signal.soWhat && (
          <span className="mt-0.5 line-clamp-2 text-dense leading-snug text-muted-foreground">
            {signal.soWhat}
          </span>
        )}
        {/* Where we caught it, and — ungrouped — who moved. The title used to
            carry the competitor because the insight opens with its name; it is
            stripped from the title now, so it reads here instead. */}
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
          {showCompetitor && (
            <>
              <span
                className="shrink-0 truncate font-medium"
                style={competitorNameColor(signal.competitorColor)}
              >
                {signal.competitorName}
              </span>
              <span aria-hidden>·</span>
            </>
          )}
          <span className="truncate">{sourceLabel(signal.sourceType)}</span>
          <span aria-hidden>·</span>
          <CatText category={signal.category} />
          {/* L2 provenance marker — this row was reconstructed from the web archive. */}
          {signal.filteredReason === "backfill" && (
            // Below the 14px floor on purpose: everywhere else the marker sits
            // NEXT TO the words "From archive" and 14 matches their weight. Here
            // it is bare on an 11px line, so at 14 the glyph stands ~2x the
            // x-height and gets read before the source it annotates.
            <ArchiveIcon
              size={12}
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
        {/* 8px, not 6: at 6 the dot sat under the age's x-height and read as
            punctuation. The name it used to carry now lives in the row's
            accessible name (sr-only, above), so this is decoration. */}
        {unread && <span className="size-2 rounded-full bg-primary" aria-hidden />}
      </span>
    </button>
  );
}

/**
 * A fold of near-duplicate signals shown as one row: always ONE competitor and one
 * category, inside one window (or the server-side batch they were grouped into,
 * patch-26).
 *
 * It is a DISCLOSURE, not a selectable row — expanding reveals the individual
 * signals underneath, and each of those opens on its own. That is the invariant
 * the first attempt at batching broke: a group must never become the thing the
 * detail pane shows, because the pane shows exactly one signal.
 *
 * The gutter is the signal row's (competitor mark over severity band), so a fold
 * reads as a row of the same family rather than a foreign object in the list. The
 * unread COUNT is on the row: a fold hides rows, it must not hide how many of them
 * are still waiting.
 */
export function FoldRow({
  signals,
  summary,
  expanded,
  onToggle,
  showCompetitor = true,
}: {
  signals: Signal[];
  summary: string | null;
  expanded: boolean;
  onToggle: () => void;
  /** Off under a competitor heading, exactly as on SignalRow. */
  showCompetitor?: boolean;
}) {
  const first = signals[0]!;
  const maxSev = signals.reduce<Sev>((m, s) => {
    const sev = s.severityOverride ?? s.severity;
    return SEV_RANK[sev] > SEV_RANK[m] ? sev : m;
  }, "low");
  const unread = signals.filter((s) => !s.isRead).length;
  const newest = signals.reduce(
    (acc, s) => (s.createdAt > acc ? s.createdAt : acc),
    first.createdAt,
  );

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      // The label is authored rather than composed from the content, so the
      // unread count has to be said here or it is not said at all — the visible
      // "N unread" below is inside an element the label overrides.
      aria-label={`${expanded ? "Collapse" : "Expand"} ${signals.length} similar signals from ${first.competitorName}${unread > 0 ? `, ${unread} unread` : ""}`}
      className="group relative grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-2.5 rounded-md px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50"
    >
      <span className="flex shrink-0 flex-col items-center gap-1">
        <CompAvatar
          name={first.competitorName}
          url={first.competitorUrl}
          size={18}
        />
        <SeverityGauge severity={maxSev} />
      </span>

      <span className="min-w-0">
        <span
          className={cn(
            // Same 700/400 step as SignalRow — a fold holding unread members has
            // to shout as loud as a single unread row, or the backlog hides behind it.
            "block truncate text-dense leading-snug",
            unread > 0
              ? "font-bold text-foreground"
              : "font-normal text-muted-foreground",
          )}
        >
          {/* The AI batch summary when the grouping came from the server, else a
              plain count. Neither names the competitor reliably, so the meta line
              under it always does. */}
          {summary ??
            `${signals.length} similar ${catLabel(first.category).toLowerCase()} signals`}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
          <StackIcon size={14} className="shrink-0" aria-hidden />
          {showCompetitor && (
            <>
              <span
                className="truncate font-medium"
                style={competitorNameColor(first.competitorColor)}
              >
                {first.competitorName}
              </span>
              <span aria-hidden>·</span>
            </>
          )}
          <span className="shrink-0 tabular-nums">{signals.length}</span>
          <span className="shrink-0">signals</span>
          {unread > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0 font-medium text-foreground tabular-nums">
                {unread} unread
              </span>
            </>
          )}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
        <time className="text-meta text-muted-foreground tabular-nums">
          {shortAge(newest)}
        </time>
        <CaretDownIcon
          size={16}
          className={cn(
            "text-muted-foreground transition-transform",
            !expanded && "-rotate-90",
          )}
          aria-hidden
        />
      </span>
    </button>
  );
}
