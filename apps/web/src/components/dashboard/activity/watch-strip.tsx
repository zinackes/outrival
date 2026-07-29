"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ActivityBucket, ActivityFinding, ActivityUpcoming } from "@/lib/api";
import { cn } from "@/lib/utils";
import { barSegments, type BarSegment } from "./format";
import { formatTime } from "@/lib/format-date";
import { sourceLabel } from "@/lib/source-labels";
import { competitorNameColor } from "@/lib/competitor-color";
import { CompAvatar } from "@/components/dashboard/comp-avatar";

// 24 hours of history in clock hours, then the checks the scheduler already has
// queued. One object answers both halves of "is it still watching": the work
// done, and the work due.
const SLOTS = 24;
const HOUR = 3_600_000;
const FUTURE_MINUTES = 180;
// 24h of history against 3h of schedule, so an hour is the same width on both
// sides of now.
const PAST_PCT = 88.9;
const FUTURE_PCT = 100 - PAST_PCT;

// How tall a bar can get, and the check count that reaches it. Height carries the
// volume of work, so a busy hour has to look busier than a quiet one — but scaling
// against the window's own maximum would make a day of single checks draw
// full-height bars, so the reference has a floor.
const BAR_MIN = 6;
const BAR_MAX = 40;
const BAR_STUB = 3; // an observed zero: nothing was due, which is not a hole
const BUSY_REFERENCE = 6;

// The logo that caps an hour which found something, and the gap it keeps off its
// bar. At 24 slots a legible mark stops fitting below the sm breakpoint, so those
// widths keep the plain dot rather than drawing marks over their neighbours. The
// strip is h-20 rather than h-16 because BAR_MAX + MARK_GAP + MARK reaches 60px,
// which in the old box sat on top of the "overnight" label.
const MARK = 16;
const MARK_GAP = 4;
// How many of an hour's competitors the cap is willing to name at once. The marks
// fan out inside the bar's own column, so past this they overlap into a smear —
// the card above still lists the hour finding by finding.
const MAX_MARKS = 4;

// The card is drawn above the strip, under a topbar that is sticky at 52px. An
// hour with several findings makes a tall card, so on a scrolled page it was
// drawn UNDER that bar and lost its first lines. Two answers, both needed: cap
// what the card says, and flip it below the strip when the room above is gone.
const MAX_CARD_FINDINGS = 4;
const TOPBAR_SAFE = 60;

// Hours the user is asleep. Outrival keeps checking through them, which is most
// of the reason this page exists.
const NIGHT_FROM = 22;
const NIGHT_TO = 7;

interface Bar {
  slot: number;
  left: number;
  width: number;
  height: number;
  // The hour's outcomes, bottom to top. An hour that both found a change and
  // lost a source draws both, rather than picking one to stand for the hour.
  segments: BarSegment[];
  start: Date;
  end: Date;
  checks: number;
  findings: ActivityFinding[];
}

// What the hour's cap stands for. An hour holding both outcomes is capped by the
// failure: the bar already says a change is in there too, and of the two it is
// the unreachable source that costs the reader something.
function markKind(bar: Bar): "change" | "failed" | null {
  if (bar.segments.some((s) => s.kind === "failed")) return "failed";
  return bar.segments.some((s) => s.kind === "change") ? "change" : null;
}

/** One hour of the strip, as the log below reads it. */
export interface WatchHour {
  /** The hour's own bounds, so the log lists exactly the runs the bar counted. */
  from: string;
  to: string;
  label: string;
}

export function WatchStrip({
  buckets,
  findings,
  upcoming,
  loading,
  failed,
  onRetry,
  onSelectHour,
  selectedFrom,
}: {
  buckets: ActivityBucket[];
  // The named findings of the window: what caps an hour that moved with the
  // competitor's own logo, and what hovering a bar reads out source by source.
  findings: ActivityFinding[];
  upcoming: ActivityUpcoming[];
  loading: boolean;
  // A strip drawn from a failed request looks exactly like a day where nothing
  // ran, which is the one reading it must never give by accident. Say so instead.
  failed: boolean;
  onRetry: () => void;
  // Picking an hour narrows the log below to it: the strip says an hour moved,
  // and this is how the reader gets from that to the runs behind it.
  onSelectHour: (hour: WatchHour) => void;
  // The hour the log is currently narrowed to, so the strip keeps saying which
  // one it is after the page has scrolled away from the chip.
  selectedFrom: string | null;
}) {
  // The strip is drawn relative to the browser's clock, so it can only be built
  // after mount: rendering it during SSR would place `now` at request time and
  // hydrate into a different picture.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    // Redraw every minute so "now" and the next check stay honest on an open tab.
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const model = useMemo(() => {
    if (now == null) return null;
    const bySlot = new Map(buckets.map((b) => [b.slot, b]));

    // The strip is cut on the clock, not on the request minute: slot 0 is the hour
    // in progress, so a bar spans 16:00 to 17:00 rather than 16:45 to 17:45. The
    // window therefore runs from a whole hour to now, and the hour in progress
    // draws as the part of it that has already happened.
    const hourStart = new Date(now).setMinutes(0, 0, 0);
    const windowStart = hourStart - (SLOTS - 1) * HOUR;
    const span = now - windowStart;
    const pct = (t: number) => ((t - windowStart) / span) * PAST_PCT;

    // Attribute each finding to the hour it happened in, so a bar can name it.
    const findingsBySlot = new Map<number, ActivityFinding[]>();
    for (const f of findings) {
      const at = new Date(f.recordedAt).setMinutes(0, 0, 0);
      const slot = Math.round((hourStart - at) / HOUR);
      if (slot < 0 || slot >= SLOTS) continue;
      const list = findingsBySlot.get(slot);
      if (list) list.push(f);
      else findingsBySlot.set(slot, [f]);
    }

    // Height reads as volume of work, so it needs the busiest hour before any bar
    // can be sized.
    const busiest = buckets.reduce((m, b) => Math.max(m, b.checks), BUSY_REFERENCE);

    const bars: Bar[] = [];
    const nightSlots: boolean[] = [];
    for (let slot = SLOTS - 1; slot >= 0; slot--) {
      // Slot s covers the clock hour [hourStart - s·1h, +1h), clipped at now for
      // the hour still running.
      const startMs = hourStart - slot * HOUR;
      const start = new Date(startMs);
      const end = new Date(Math.min(startMs + HOUR, now));
      nightSlots[SLOTS - 1 - slot] = start.getHours() >= NIGHT_FROM || start.getHours() < NIGHT_TO;

      const left = pct(startMs);
      const common = {
        slot,
        left,
        width: pct(end.getTime()) - left,
        start,
        end,
        findings: findingsBySlot.get(slot) ?? [],
      };
      const b = bySlot.get(slot);
      if (!b || b.checks === 0) {
        // An observed zero keeps a stub, so an hour with nothing due reads as
        // "nothing due" and not as a hole in the record.
        bars.push({
          ...common,
          height: BAR_STUB,
          segments: [{ kind: "quiet", count: 0, height: BAR_STUB }],
          checks: 0,
        });
        continue;
      }
      const volume = Math.round(BAR_MIN + Math.min(b.checks / busiest, 1) * (BAR_MAX - BAR_MIN));
      const stack = barSegments(volume, b.checks, b.changes, b.failures);
      bars.push({ ...common, height: stack.height, segments: stack.segments, checks: b.checks });
    }

    // Contiguous night runs, so the shading is one band per night rather than 24
    // adjacent cells (and survives a window that spans two of them).
    const bands: { left: number; width: number; slots: number }[] = [];
    let i = 0;
    while (i < SLOTS) {
      if (!nightSlots[i]) {
        i++;
        continue;
      }
      const from = i;
      while (i < SLOTS && nightSlots[i]) i++;
      // Bar index k is the hour starting windowStart + k·1h.
      const left = pct(windowStart + from * HOUR);
      bands.push({
        left,
        width: pct(Math.min(windowStart + i * HOUR, now)) - left,
        slots: i - from,
      });
    }
    const widest = bands.reduce<{ left: number; width: number; slots: number } | null>(
      (m, b) => (m === null || b.slots > m.slots ? b : m),
      null,
    );

    // Only the checks due inside the window the strip draws.
    const scheduled = upcoming
      .map((u) => ({ u, inMinutes: (new Date(u.nextRunAt).getTime() - now) / 60_000 }))
      .filter((x) => x.inMinutes <= FUTURE_MINUTES)
      .map((x) => ({
        ...x,
        // An overdue check has not happened yet either: pin it just past now
        // rather than drawing it in the past, where it would read as done.
        left: PAST_PCT + (Math.max(x.inMinutes, 0) / FUTURE_MINUTES) * FUTURE_PCT,
      }));

    // Marks on whole hours, placed where their hour actually starts, so the axis
    // reads 16:00 and not the minute the page happened to load.
    const axis = [0, 6, 12, 18].map((hoursIn) => ({
      label: formatTime(new Date(windowStart + hoursIn * HOUR), {
        hour: "numeric",
        minute: "2-digit",
      }),
      // The axis row is its own box, already sized to the past region, so a mark
      // is placed as a fraction of THAT rather than of the whole strip.
      left: ((hoursIn * HOUR) / span) * 100,
    }));
    const nowLabel = formatTime(new Date(now), { hour: "numeric", minute: "2-digit" });

    const checks = buckets.reduce((n, b) => n + b.checks, 0);
    const findingCount = buckets.reduce((n, b) => n + b.changes + b.failures, 0);

    return {
      bars,
      bands,
      widest,
      scheduled,
      axis,
      nowLabel,
      checks,
      findingCount,
      windowStart,
      span,
    };
  }, [buckets, findings, upcoming, now]);

  // One shared cursor rather than 24 hover targets: the pointer's x resolves to a
  // bucket, which is cheaper than a tooltip root per bar and keeps the reading on
  // one element.
  const stripRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  // Mirrors `hovered` for the handlers that have to read it during the event that
  // is about to change it (a tap decides what it means from where the cursor
  // already was).
  const shownRef = useRef<number | null>(null);
  const show = useCallback((slot: number | null) => {
    shownRef.current = slot;
    setHovered(slot);
  }, []);

  // A finger has no hover, so the strip's whole reading was unreachable on a
  // phone: a tap went straight to selecting the hour, and the card naming what
  // that hour holds never appeared. Touch therefore reads in two taps — the first
  // opens the card where a hover would have, the second hands the hour to the log
  // — which is also what makes a tap on a 24-slot strip recoverable when it lands
  // one hour off.
  const [touch, setTouch] = useState(false);
  const tapArmed = useRef(false);

  const slotAt = useCallback(
    (clientX: number): number | null => {
      const el = stripRef.current;
      if (!el || !model) return null;
      const rect = el.getBoundingClientRect();
      const pastWidth = (rect.width * PAST_PCT) / 100;
      const x = clientX - rect.left;
      if (x < 0 || x > pastWidth) return null;
      // The window ends on `now` mid-hour, so x resolves through time rather than
      // through equal columns.
      const at = model.windowStart + (x / pastWidth) * model.span;
      const index = Math.floor((at - model.windowStart) / HOUR);
      return Math.min(SLOTS - 1, Math.max(0, SLOTS - 1 - index));
    },
    [model],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // A touch drag is a scroll, not a reading: only a real cursor moves this one.
      if (e.pointerType !== "mouse") return;
      setTouch(false);
      show(slotAt(e.clientX));
    },
    [slotAt, show],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse") return;
      setTouch(true);
      const slot = slotAt(e.clientX);
      // Second tap on the hour already open: this one selects.
      tapArmed.current = slot != null && slot === shownRef.current;
      show(slot);
    },
    [slotAt, show],
  );

  // A card opened by a tap has no pointerleave to close it, so anything outside
  // the strip does.
  useEffect(() => {
    if (!touch || hovered == null) return;
    const away = (e: PointerEvent) => {
      if (!stripRef.current?.contains(e.target as Node)) show(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [touch, hovered, show]);

  // Hand the hour to the log. An hour where nothing ran has no runs to show, so
  // it is not selectable: narrowing to it would answer a click with an empty list.
  const select = useCallback(
    (slot: number | null) => {
      const bar = slot == null ? null : (model?.bars.find((b) => b.slot === slot) ?? null);
      if (!bar || bar.checks === 0) return;
      onSelectHour({
        from: bar.start.toISOString(),
        // The whole clock hour, not the bar's drawn end: slot 0 stops at the `now`
        // this strip last redrew on, and a run recorded since then belongs to the
        // hour the reader just clicked.
        to: new Date(bar.start.getTime() + HOUR).toISOString(),
        label: `${formatTime(bar.start)} to ${bar.slot === 0 ? "now" : formatTime(bar.end)}`,
      });
    },
    [model, onSelectHour],
  );

  // Arrow keys walk the same cursor and Enter picks the hour under it, so the
  // reading and the filter are both reachable without a mouse.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select(hovered);
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const from = shownRef.current ?? 0;
      const next = e.key === "ArrowLeft" ? from + 1 : from - 1;
      show(Math.min(SLOTS - 1, Math.max(0, next)));
    },
    [hovered, select, show],
  );

  // A mouse click picks the hour under the cursor. A tap only does once the card
  // for that hour is already open.
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (touch && !tapArmed.current) return;
      select(slotAt(e.clientX));
      if (touch) show(null);
    },
    [select, slotAt, show, touch],
  );

  const hoveredBar = hovered == null ? null : (model?.bars.find((b) => b.slot === hovered) ?? null);
  const selectedBar = selectedFrom
    ? (model?.bars.find((b) => b.start.toISOString() === selectedFrom) ?? null)
    : null;

  // A check already handed to the fleet outranks the soonest scheduled one: it is
  // the only line here describing work that has actually started moving.
  const next = upcoming.find((u) => u.activity) ?? upcoming[0] ?? null;

  if (failed) {
    return (
      <section className="flex flex-col gap-1.5" aria-label="Checks over the last 24 hours">
        <div className="flex items-baseline justify-between gap-3 text-dense text-muted-foreground">
          <span className="font-medium text-foreground">Last 24 hours</span>
          {next && <NextCheck next={next} />}
        </div>
        <p className="text-dense text-muted-foreground">
          We couldn&apos;t load the last 24 hours, so this is not a quiet day, it is a missing
          reading.{" "}
          <button
            type="button"
            onClick={onRetry}
            className="text-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Retry
          </button>
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Checks over the last 24 hours">
      <div className="flex items-baseline justify-between gap-3 text-dense text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">Last 24 hours</span>
          {model && (
            <>
              {" · "}
              {model.checks === 0 ? (
                "no checks ran"
              ) : (
                <>
                  <span className="tabular-nums">{model.checks}</span> check
                  {model.checks === 1 ? "" : "s"},{" "}
                  <span className="tabular-nums">{model.findingCount}</span> finding
                  {model.findingCount === 1 ? "" : "s"}
                </>
              )}
            </>
          )}
        </span>
        {next && <NextCheck next={next} />}
      </div>

      <div
        ref={stripRef}
        className={cn(
          "relative h-20 border-b border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          hoveredBar && hoveredBar.checks > 0 && "cursor-pointer",
        )}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        // Touch fires this on lift, which would close the card the tap just opened.
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") show(null);
        }}
        // The browser took the gesture over to scroll the page: that touch was
        // never a reading, so it leaves no card behind.
        onPointerCancel={() => show(null)}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onBlur={() => show(null)}
        tabIndex={model ? 0 : -1}
        role="img"
        aria-label={
          model
            ? `${model.checks} checks over the last 24 hours, ${model.findingCount} of them found something. Use the arrow keys to read an hour at a time, and Enter to list that hour's checks below.`
            : "Checks over the last 24 hours"
        }
      >
        {model && (
          <>
            {model.bands.map((band) => (
              <div
                key={band.left}
                className="absolute inset-y-0 rounded-t-sm bg-night"
                style={{ left: `${band.left}%`, width: `${band.width}%` }}
                aria-hidden
              >
                {model.widest === band && band.slots >= 4 && (
                  <span className="absolute left-1/2 top-0.5 -translate-x-1/2 font-mono text-meta text-muted-foreground">
                    overnight
                  </span>
                )}
              </div>
            ))}

            {/* The hovered hour, marked behind the bars so the bar itself stays
                the brightest thing in its own column. It slides from hour to hour
                rather than teleporting, so the cursor reads as one mark moving
                along the strip instead of 24 marks blinking on and off. */}
            {hoveredBar && (
              <div
                className="absolute inset-y-0 animate-in bg-surface-3 fade-in-0 transition-[left,width] duration-150 ease-out"
                style={{ left: `${hoveredBar.left}%`, width: `${hoveredBar.width}%` }}
                aria-hidden
              />
            )}

            {/* The hour the log is narrowed to. An outline rather than a second
                fill, so it stays legible under the cursor's own band. */}
            {selectedBar && (
              <div
                className="absolute inset-y-0 rounded-t-sm border-x border-t border-dashed border-foreground"
                style={{ left: `${selectedBar.left}%`, width: `${selectedBar.width}%` }}
                aria-hidden
              />
            )}

            {model.bars.map((bar) => {
              return (
                <span
                  key={bar.slot}
                  className="absolute bottom-0 flex flex-col-reverse overflow-hidden rounded-t-[1.5px]"
                  // The gutter that keeps two calm hours from fusing into one
                  // ribbon is split across both edges, not taken off the right:
                  // the cursor's band spans the whole hour, so a one-sided
                  // gutter reads as the bar failing to fill its own column. The
                  // floor keeps the hour in progress visible in its first
                  // minutes, when its share of the window is thinner than the
                  // gutter itself.
                  style={{
                    left: `calc(${bar.left}% + 1px)`,
                    width: `max(2px, calc(${bar.width}% - 2px))`,
                    height: `${bar.height}px`,
                  }}
                  aria-hidden
                >
                  {/* A bar's colour says what its hour FOUND, and nothing else.
                      Brightening it under the cursor made a quiet hour borrow the
                      colour of a change for as long as it was being read; the band
                      behind the bar is what marks the hour instead. */}
                  {bar.segments.map((s) => (
                    <i
                      key={s.kind}
                      className={cn(
                        "block w-full",
                        s.kind === "change" && "bg-foreground",
                        s.kind === "failed" && "bg-critical",
                        s.kind === "quiet" && (bar.checks === 0 ? "bg-border" : "bg-border-strong"),
                      )}
                      style={{ height: `${s.height}px` }}
                    />
                  ))}
                </span>
              );
            })}

            {/* A cap over a finding's bar, so a change reads by shape before it
                reads by colour — and, where the width allows a legible one, by
                WHO. */}
            {model.bars.map((bar) => {
              const kind = markKind(bar);
              return (
                kind && (
                  <FindingMark
                    key={`pin-${bar.slot}`}
                    bar={bar}
                    kind={kind}
                    expanded={hoveredBar?.slot === bar.slot}
                  />
                )
              );
            })}

            {/* Everything right of now: scheduled, not observed. */}
            <div
              className="absolute inset-y-0 right-0 bg-[repeating-linear-gradient(45deg,var(--border)_0_1px,transparent_1px_10px)]"
              style={{ left: `${PAST_PCT}%` }}
              aria-hidden
            />
            {model.scheduled.map(({ u, left }) => (
              <span
                key={u.monitorId}
                title={`${u.competitorName} · ${sourceLabel(u.sourceType)} · scheduled`}
                className="absolute bottom-0 h-[13px] w-2 rounded-t-[1.5px] border border-b-0 border-border-strong bg-background"
                style={{ left: `${left}%` }}
              />
            ))}

            <div className="absolute inset-y-0 -bottom-px w-px bg-foreground" style={{ left: `${PAST_PCT}%` }}>
              <span className="absolute -left-[2.5px] top-0 size-1.5 rounded-full bg-foreground" aria-hidden />
              <span className="absolute left-2.5 -top-0.5 font-mono text-meta text-foreground">now</span>
            </div>

            {hoveredBar && <BucketCard bar={hoveredBar} stripRef={stripRef} touch={touch} />}
          </>
        )}
        {!model && loading && (
          <div className="absolute inset-x-0 bottom-0 h-2 animate-pulse rounded-sm bg-surface-2" />
        )}
      </div>

      {model && (
        <div className="flex font-mono text-meta text-muted-foreground tabular-nums">
          <div className="relative h-3.5" style={{ flex: `0 0 ${PAST_PCT}%` }}>
            {model.axis.map((mark, i) => (
              <span
                key={mark.label}
                className={cn(
                  "absolute top-0",
                  i === 0 ? "left-0" : "-translate-x-1/2",
                  i % 2 === 1 && "hidden sm:inline",
                )}
                style={i === 0 ? undefined : { left: `${mark.left}%` }}
              >
                {mark.label}
              </span>
            ))}
            <span className="absolute right-0 top-0">{model.nowLabel}</span>
          </div>
          <div className="flex-1 whitespace-nowrap text-right text-text-subtle max-sm:hidden">
            next 3h
          </div>
        </div>
      )}

      <p className="flex flex-wrap gap-x-3.5 gap-y-1 text-meta text-muted-foreground">
        <LegendItem className="bg-foreground">found a change</LegendItem>
        <LegendItem className="bg-critical">could not be reached</LegendItem>
        <LegendItem className="bg-border-strong">checks run</LegendItem>
        <LegendItem className="border border-b-0 border-border-strong">scheduled</LegendItem>
      </p>
    </section>
  );
}

// What caps an hour that found something. The logo names WHO moved without
// spending a hover, which is the one thing the bars cannot say: they carry the
// volume of work and the fact that it moved, never the name.
//
// The mark is a decoration, not a control — the hour it caps is read through the
// strip's own cursor (pointer or arrow keys), which already names every finding
// of the bucket, including the ones a single mark cannot show.
//
// Under the cursor the cap opens: an hour that moved for several competitors
// fans its stacked marks out so all of them are named at once. The fan is laid
// out INSIDE the bar's own column (first mark on its left edge, last on its
// right), so however many it holds it never spills over the neighbouring hours.
function FindingMark({
  bar,
  kind,
  expanded,
}: {
  bar: Bar;
  kind: "change" | "failed";
  expanded: boolean;
}) {
  // Findings arrive newest first, so the hour is capped by its latest one — of
  // the kind the CAP draws, so a red mark never names a competitor whose source
  // was reached fine. An hour that moved for more than one competitor gets a tile
  // behind the mark, so the logo never claims it belonged to a single name.
  const lead = bar.findings.find((f) => f.kind === kind) ?? bar.findings[0] ?? null;
  const names = new Set(bar.findings.map((f) => f.competitorId)).size;
  // One mark per competitor, the cap's own first, so the fan opens from the mark
  // that was already there instead of reshuffling under the cursor.
  const marks = useMemo(() => {
    if (!lead) return [];
    const seen = new Set<string>();
    const out: ActivityFinding[] = [];
    for (const f of [lead, ...bar.findings]) {
      if (seen.has(f.competitorId) || out.length === MAX_MARKS) continue;
      seen.add(f.competitorId);
      out.push(f);
    }
    return out;
  }, [bar.findings, lead]);
  const bottom = `${bar.height + MARK_GAP}px`;
  const fanned = expanded && marks.length > 1;
  return (
    <>
      {/* The dot the logo replaces. Kept where a logo would not fit, and kept
          outright when the finding count outran the named findings the summary
          sends: a bar that moved is never left uncapped. Centred on its hour, but
          never past now: the hour in progress is a sliver of a column in its first
          minutes, so a centred cap straddles the line and reads as scheduled. */}
      <span
        className={cn(
          "absolute size-[5px] rounded-full",
          lead && "sm:hidden",
          kind === "failed" ? "bg-critical" : "bg-foreground",
        )}
        style={{
          left: `min(calc(${bar.left + bar.width / 2}% - 2.5px), calc(${PAST_PCT}% - 6px))`,
          bottom,
        }}
        aria-hidden
      />
      {marks.length > 0 && (
        <span
          className="absolute max-sm:hidden"
          // The fan opens inside the bar's own column, so it takes the bar's
          // geometry verbatim: a fan laid out on the raw hour would put its last
          // mark past the edge of the bar it caps.
          //
          // Anchored on the hour's END rather than its start, and floored at one
          // mark wide. The hour in progress is drawn from its whole start to now,
          // so at 09:02 its column is about a pixel: a cap centred in it hung half
          // its width past the now line, into the hatched region that means
          // scheduled. Pinned to the end instead, it grows leftwards into the past
          // it belongs to. A column already wider than a mark resolves to exactly
          // the old geometry (left edge = bar.left + 1px), so only the sliver moves.
          style={{
            right: `calc(${100 - bar.left - bar.width}% + 1px)`,
            width: `max(${MARK}px, calc(${bar.width}% - 2px))`,
            height: MARK,
            bottom,
          }}
          aria-hidden
        >
          {marks.map((f, i) => {
            // Fanned, the marks divide the column between its two edges; stacked,
            // they all sit on the cap's own centre. Both ends are `pct - px`, so
            // the two states interpolate rather than jump.
            const t = marks.length > 1 ? i / (marks.length - 1) : 0;
            const left = fanned
              ? `calc(${t * 100}% - ${t * MARK}px)`
              : `calc(50% - ${MARK / 2}px)`;
            return (
              <span
                key={f.competitorId}
                className="absolute top-0 transition-[left,opacity] duration-200 ease-out"
                style={{
                  left,
                  // Only the cap shows while stacked: the rest are exactly under
                  // it, and drawing them there would just thicken its edge.
                  opacity: i === 0 || fanned ? 1 : 0,
                  // The cap stays on top as the others slide out from under it.
                  zIndex: marks.length - i,
                  transitionDelay: fanned ? `${i * 40}ms` : "0ms",
                }}
              >
                {i === 0 && names > 1 && (
                  <span
                    className="absolute rounded-[4px] border border-border bg-surface-2 transition-opacity duration-200 ease-out"
                    // The "there are more" tile has said its piece once the marks
                    // it stood for are out.
                    style={{ right: -3, top: -3, width: MARK, height: MARK, opacity: fanned ? 0 : 1 }}
                  />
                )}
                <span
                  className={cn(
                    "relative block rounded-[4px]",
                    f.kind === "failed" && "ring-1 ring-critical",
                  )}
                >
                  <CompAvatar name={f.competitorName} url={f.url} size={MARK} />
                </span>
              </span>
            );
          })}
        </span>
      )}
    </>
  );
}

// What one hour holds. Anchored to its own bar and clamped to the strip, so a
// bucket at either end still reads inside the page. It rides the same slide as
// the band under it, so it only fades in once, on entering the strip.
function BucketCard({
  bar,
  stripRef,
  touch,
}: {
  bar: Bar;
  stripRef: React.RefObject<HTMLDivElement | null>;
  // Touch reached this card with one tap and needs a second to open the hour, so
  // the card has to say which gesture it is waiting for.
  touch: boolean;
}) {
  const centre = bar.left + bar.width / 2;
  const clamped = Math.min(88, Math.max(12, centre));
  // An hour can hold more findings than a hover is worth reading. The card names
  // the first few and counts the rest; clicking the bar lists all of them below.
  const shown = bar.findings.slice(0, MAX_CARD_FINDINGS);
  const rest = bar.findings.length - shown.length;

  // Above the strip by default, below it when the page has scrolled far enough
  // that the topbar would cover the card's first lines. The height is measured
  // rather than estimated, and it is the same in either placement, so the
  // decision cannot oscillate between the two.
  const ref = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      const card = ref.current;
      const strip = stripRef.current;
      if (!card || !strip) return;
      setBelow(strip.getBoundingClientRect().top - card.offsetHeight - 6 < TOPBAR_SAFE);
    };
    measure();
    // Scrolling with the pointer parked on a bar moves the strip under a card
    // that has already chosen its side. Capture, because the page's scroller is
    // not necessarily the window and scroll events do not bubble.
    document.addEventListener("scroll", measure, { passive: true, capture: true });
    return () => document.removeEventListener("scroll", measure, { capture: true });
  }, [bar.slot, shown.length, stripRef]);

  return (
    <div
      ref={ref}
      className={cn(
        "pointer-events-none absolute z-10 max-w-[17rem] -translate-x-1/2 animate-in rounded-md border border-border bg-surface-2 px-2.5 py-1.5 shadow-xs fade-in-0 zoom-in-95 transition-[left] duration-150 ease-out",
        below ? "top-full mt-1.5" : "bottom-full mb-1.5",
      )}
      style={{ left: `${clamped}%` }}
      aria-live="polite"
    >
      <div className="font-mono text-meta text-muted-foreground tabular-nums">
        {formatTime(bar.start)} to {bar.slot === 0 ? "now" : formatTime(bar.end)}
      </div>
      <div className="whitespace-nowrap text-dense text-foreground">
        {bar.checks === 0 ? (
          "No check due"
        ) : (
          <>
            <span className="tabular-nums">{bar.checks}</span> check
            {bar.checks === 1 ? "" : "s"}
            {bar.findings.length === 0 && (
              <span className="text-muted-foreground">, nothing new</span>
            )}
          </>
        )}
      </div>
      {/* One outcome per line, coloured the way the bar under it is: a change and
          an unreachable source read alike in plain muted text, which is exactly
          the distinction this card exists to make. */}
      {shown.map((f, i) => (
        <div key={`${f.recordedAt}-${i}`} className="flex items-center gap-1.5 text-dense">
          <i
            className={cn(
              "h-2.5 w-[3px] shrink-0 rounded-t-[1px]",
              f.kind === "failed" ? "bg-critical" : "bg-foreground",
            )}
            aria-hidden
          />
          <span className="min-w-0 truncate">
            <span className="font-medium text-foreground">{f.competitorName}</span>
            <span className="text-muted-foreground">
              {" "}
              {sourceLabel(f.sourceType).toLowerCase()}{" "}
            </span>
            <span className={f.kind === "failed" ? "text-critical" : "text-foreground"}>
              {f.kind === "failed" ? "could not be reached" : "found a change"}
            </span>
          </span>
        </div>
      ))}
      {rest > 0 && (
        <div className="text-dense text-muted-foreground">
          and <span className="tabular-nums">{rest}</span> more
        </div>
      )}
      {bar.checks > 0 && (
        <div className="mt-0.5 text-meta text-text-subtle">
          {touch ? "Tap again to list these checks" : "Click to list these checks"}
        </div>
      )}
    </div>
  );
}

function LegendItem({ className, children }: { className: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={cn("inline-block h-[11px] w-[3px] rounded-t-[1px]", className)} aria-hidden />
      {children}
    </span>
  );
}

// The soonest scheduled check, named. This is the whole of the old "Next check"
// line: the strip already draws the rest of the queue.
function NextCheck({ next }: { next: ActivityUpcoming }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const compute = () => {
      // Already handed to the fleet: the schedule is no longer what it waits on.
      if (next.activity) {
        setLabel(next.activity === "scraping" ? "running now" : "queued, waiting for a scanner");
        return;
      }
      const mins = Math.round((new Date(next.nextRunAt).getTime() - Date.now()) / 60_000);
      // An overdue nextRunAt only means the hourly cron has not picked the monitor
      // up yet: the check is pending, never "12 minutes ago". Name the hour it is
      // fanned out on, so "due" doesn't read as "stuck".
      if (mins <= 1) {
        const top = new Date();
        top.setMinutes(0, 0, 0);
        setLabel(`due, runs ${formatTime(top.getTime() + 3_600_000)}`);
        return;
      }
      setLabel(mins < 60 ? `in ${mins} min` : `in ${Math.round(mins / 60)}h`);
    };
    compute();
    const id = setInterval(compute, 30_000);
    return () => clearInterval(id);
  }, [next.nextRunAt, next.activity]);

  if (!label) return null;
  return (
    <span className="min-w-0 truncate">
      Next check <span className="font-medium text-foreground">{label}</span>
      {" · "}
      <Link
        href={next.isSelf ? "/dashboard/products" : `/dashboard/competitors/${next.competitorId}`}
        className="hover:underline"
        style={competitorNameColor(next.competitorColor)}
      >
        {next.competitorName}
      </Link>{" "}
      {sourceLabel(next.sourceType).toLowerCase()}
    </span>
  );
}
