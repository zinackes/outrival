"use client";

import { StackIcon, ArchiveIcon, CaretDownIcon } from "@/components/icons";
import { formatDistanceToNow } from "date-fns";
import type { Signal } from "@/lib/api";
import { cn } from "@/lib/utils";
import { shortAge } from "@/lib/format-date";
import { nameCompetitor, signalTitle } from "@/lib/signal-shape";
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
 * carry a bold title, an accent wash and a leading dot. Selection is a stronger
 * tint of that same accent (no bar).
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
      // Hover disclosure for the rows whose meta line does not carry the name (a
      // competitor heading stands over them, and it scrolls away — only the tier
      // header above it sticks). It cannot live on the avatar: that fades out under
      // the selection checkbox on the very hover that would reveal it.
      title={showCompetitor ? undefined : signal.competitorName}
      onFocus={onFocus}
      onClick={onSelect}
      className={cn(
        "group relative grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-2.5 rounded-md px-3 py-2.5 text-left outline-none transition-colors",
        // Unread is an AREA, not three attributes of a text run. Bold title, full
        // ink against a read row's 85%, and a dot all sat inside the row's middle
        // and right end; over sixty rows the list still read as uniform, because
        // the column the eye enters on (the gutter) and the row's surface said
        // nothing. The wash is the dot's own ink at 8% — the same accent ramp the
        // row already climbs on hover (50%) and selection (100%), so it reads as
        // one scale of "marked" rather than a fourth colour. Still no rail: the
        // gauge owns the gutter, and a second thin vertical to its left stuttered.
        unread && "bg-primary/8",
        selected ? "bg-accent" : "hover:bg-accent/50 focus-visible:bg-accent/50",
      )}
    >
      {/* The unread mark, at the row's LEADING edge. It used to trail the age —
          the column the eye reaches LAST, so every cue for a binary state sat at
          the far end of the row. Here it lands where the scan starts, in the
          padding left of the gutter, and a backlog shows its shape down one edge.
          Absolute rather than a grid column: reserving one on every row would
          indent the whole list by the width of a mark only some rows carry. The
          15px offset centres it on the title's first line (10px pad + half of a
          13/1.375 line), not on the row, whose height varies with the so-what. */}
      {unread && (
        <span
          className="absolute left-0.5 top-[15px] size-2 rounded-full bg-primary"
          aria-hidden
        />
      )}

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
            color={signal.competitorColor}
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
        {/* Under a competitor heading the name is not repeated on the meta line, so
            it is not in this row's accessible name either — and a heading is not
            announced when the reader arrows through the listbox one option at a
            time. Say it here instead; sighted readers have the heading and the
            tile's colour. */}
        {!showCompetitor && (
          <span className="sr-only">{signal.competitorName}. </span>
        )}
        {/* The finding leads: it's what the reader is scanning for. */}
        <span
          className={cn(
            // Unread: 700, full ink. Read: 500 at 85% ink. Two notches and a colour
            // step below the unread row (at 600/500 in one colour a 62-item
            // backlog read as one uniform block, which is what the audit measured),
            // and the same two axes above the so-what under it: at 400 muted the
            // read title was its own description set twice (OUT-245).
            "block truncate text-dense leading-snug",
            unread
              ? "font-bold text-foreground"
              : "font-medium text-foreground/85",
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
            {nameCompetitor(signal.soWhat, signal.competitorName)}
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
          {/* The importance verdict, shown as its REASON rather than as the word
              "Important" (OUT-192): the reason is the part a reader cannot get
              anywhere else on this row, and a bare flag is what they stop
              trusting. Only the positive verdict renders — a feed that annotates
              every ordinary change with "Not important" costs a line of attention
              per row to say nothing. It truncates: the panel has it in full. */}
          {signal.isImportant && signal.importanceReason && (
            <>
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate font-medium text-foreground">
                {signal.importanceReason}
              </span>
            </>
          )}
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
          {/* The page kept serving this delta and then its exact inverse. The flips
              were folded into this one row instead of raising a card each, so the
              count is the only place that fold is visible from the list. */}
          {signal.oscillation && (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0 tabular-nums">
                Oscillating · {signal.oscillation.observations} readings
              </span>
            </>
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
      className={cn(
        "group relative grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-2.5 rounded-md px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50",
        // The same wash and mark a single unread row gets: a fold HIDES rows, so
        // it has to carry theirs, or the backlog vanishes behind the fold.
        unread > 0 && "bg-primary/8",
      )}
    >
      {unread > 0 && (
        <span
          className="absolute left-0.5 top-[15px] size-2 rounded-full bg-primary"
          aria-hidden
        />
      )}

      <span className="flex shrink-0 flex-col items-center gap-1">
        <CompAvatar
          name={first.competitorName}
          url={first.competitorUrl}
          color={first.competitorColor}
          size={18}
        />
        <SeverityGauge severity={maxSev} />
      </span>

      <span className="min-w-0">
        <span
          className={cn(
            // Same 700/500 step as SignalRow — a fold holding unread members has
            // to shout as loud as a single unread row, or the backlog hides behind
            // it, and a fully read fold has to sit level with the read rows around it.
            "block truncate text-dense leading-snug",
            unread > 0
              ? "font-bold text-foreground"
              : "font-medium text-foreground/85",
          )}
        >
          {/* The AI batch summary when the grouping came from the server, else a
              plain count. Neither names the competitor reliably, so the meta line
              under it always does. */}
          {summary
            ? nameCompetitor(summary, first.competitorName)
            : `${signals.length} similar ${catLabel(first.category).toLowerCase()} signals`}
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
