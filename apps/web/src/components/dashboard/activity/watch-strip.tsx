"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  ActivityBucket,
  ActivityChecked,
  ActivityFinding,
  ActivityUpcoming,
} from "@/lib/api";
import { cn } from "@/lib/utils";
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

// Hours the user is asleep. Outrival keeps checking through them, which is most
// of the reason this page exists.
const NIGHT_FROM = 22;
const NIGHT_TO = 7;

type BarKind = "quiet" | "change" | "failed";

interface Bar {
  slot: number;
  left: number;
  width: number;
  height: number;
  kind: BarKind;
  start: Date;
  end: Date;
  checks: number;
  findings: ActivityFinding[];
}

function bucketKind(b: ActivityBucket): BarKind {
  if (b.failures > 0) return "failed";
  if (b.changes > 0) return "change";
  return "quiet";
}

export function WatchStrip({
  buckets,
  findings,
  checked,
  upcoming,
  loading,
  failed,
  onRetry,
}: {
  buckets: ActivityBucket[];
  // The named findings of the window, so hovering a bar says WHICH source moved
  // rather than only that something did.
  findings: ActivityFinding[];
  // Who was looked at, change or no change. The bars are anonymous by design —
  // one hour holds several competitors, so no bar can name one without hiding the
  // rest — which leaves a quiet hour proved only by a count. This names them.
  checked: ActivityChecked[];
  upcoming: ActivityUpcoming[];
  loading: boolean;
  // A strip drawn from a failed request looks exactly like a day where nothing
  // ran, which is the one reading it must never give by accident. Say so instead.
  failed: boolean;
  onRetry: () => void;
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
        bars.push({ ...common, height: BAR_STUB, kind: "quiet", checks: 0 });
        continue;
      }
      bars.push({
        ...common,
        height: Math.round(BAR_MIN + Math.min(b.checks / busiest, 1) * (BAR_MAX - BAR_MIN)),
        kind: bucketKind(b),
        checks: b.checks,
      });
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

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = stripRef.current;
      if (!el || !model) return;
      const rect = el.getBoundingClientRect();
      const pastWidth = (rect.width * PAST_PCT) / 100;
      const x = e.clientX - rect.left;
      if (x < 0 || x > pastWidth) {
        setHovered(null);
        return;
      }
      // The window ends on `now` mid-hour, so x resolves through time rather than
      // through equal columns.
      const at = model.windowStart + (x / pastWidth) * model.span;
      const index = Math.floor((at - model.windowStart) / HOUR);
      setHovered(Math.min(SLOTS - 1, Math.max(0, SLOTS - 1 - index)));
    },
    [model],
  );

  // Arrow keys walk the same cursor, so the reading is reachable without a mouse.
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setHovered((prev) => {
      const from = prev ?? 0;
      const next = e.key === "ArrowLeft" ? from + 1 : from - 1;
      return Math.min(SLOTS - 1, Math.max(0, next));
    });
  }, []);

  const hoveredBar = hovered == null ? null : (model?.bars.find((b) => b.slot === hovered) ?? null);

  const next = upcoming[0] ?? null;

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
        className="relative h-16 border-b border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHovered(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setHovered(null)}
        tabIndex={model ? 0 : -1}
        role="img"
        aria-label={
          model
            ? `${model.checks} checks over the last 24 hours, ${model.findingCount} of them found something. Use the arrow keys to read an hour at a time.`
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
                the brightest thing in its own column. */}
            {hoveredBar && (
              <div
                className="absolute inset-y-0 bg-surface-3"
                style={{ left: `${hoveredBar.left}%`, width: `${hoveredBar.width}%` }}
                aria-hidden
              />
            )}

            {model.bars.map((bar) => (
              <span
                key={bar.slot}
                className={cn(
                  "absolute bottom-0 rounded-t-[1.5px]",
                  bar.kind === "change" && "bg-foreground",
                  bar.kind === "failed" && "bg-critical",
                  bar.kind === "quiet" &&
                    (bar.checks === 0
                      ? "bg-border"
                      : hoveredBar?.slot === bar.slot
                        ? "bg-foreground"
                        : "bg-border-strong"),
                )}
                style={{
                  left: `${bar.left}%`,
                  width: `calc(${bar.width}% - 2px)`,
                  height: `${bar.height}px`,
                }}
                aria-hidden
              />
            ))}

            {/* A cap over a finding's bar, so a change reads by shape before it
                reads by colour. */}
            {model.bars
              .filter((b) => b.kind !== "quiet")
              .map((bar) => (
                <span
                  key={`pin-${bar.slot}`}
                  className={cn(
                    "absolute size-[5px] rounded-full",
                    bar.kind === "failed" ? "bg-critical" : "bg-foreground",
                  )}
                  style={{
                    left: `calc(${bar.left + bar.width / 2}% - 2.5px)`,
                    bottom: `${bar.height + 4}px`,
                  }}
                  aria-hidden
                />
              ))}

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

            {hoveredBar && <BucketCard bar={hoveredBar} />}
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

      {checked.length > 0 && <Coverage checked={checked} />}

      <p className="flex flex-wrap gap-x-3.5 gap-y-1 text-meta text-muted-foreground">
        <LegendItem className="bg-foreground">found a change</LegendItem>
        <LegendItem className="bg-critical">could not be reached</LegendItem>
        <LegendItem className="bg-border-strong">checks run</LegendItem>
        <LegendItem className="border border-b-0 border-border-strong">scheduled</LegendItem>
      </p>
    </section>
  );
}

// Past this many marks the row stops being readable as a roster and starts being
// a texture. The overflow is counted rather than dropped in silence — the whole
// point of the row is that nobody is missing from it.
const COVERAGE_MAX = 14;

// Who Outrival looked at in the window, busiest first. Deliberately NOT drawn on
// the bars: an hour holds several competitors, so a mark per bar would name one
// and hide the others, and it would sit exactly where the finding pins already
// are — flattening the one contrast the strip exists to draw.
function Coverage({ checked }: { checked: ActivityChecked[] }) {
  const shown = checked.slice(0, COVERAGE_MAX);
  const rest = checked.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-meta text-muted-foreground">
      <span className="mr-0.5">Checked</span>
      {shown.map((c) => {
        const label = `${c.competitorName}, ${c.checks} check${c.checks === 1 ? "" : "s"}`;
        return (
          <Link
            key={c.competitorId}
            href={c.isSelf ? "/dashboard/products" : `/dashboard/competitors/${c.competitorId}`}
            title={label}
            aria-label={label}
            className="rounded-[4px] opacity-75 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <CompAvatar name={c.competitorName} url={c.url} size={18} />
          </Link>
        );
      })}
      {rest > 0 && <span className="tabular-nums">+{rest}</span>}
    </div>
  );
}

// What one hour holds. Anchored to its own bar and clamped to the strip, so a
// bucket at either end still reads inside the page.
function BucketCard({ bar }: { bar: Bar }) {
  const centre = bar.left + bar.width / 2;
  const clamped = Math.min(88, Math.max(12, centre));
  return (
    <div
      className="pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 shadow-xs"
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
      {bar.findings.map((f, i) => (
        <div key={`${f.recordedAt}-${i}`} className="whitespace-nowrap text-dense">
          <span className="text-foreground">{f.competitorName}</span>
          <span className="text-muted-foreground">
            {" "}
            {sourceLabel(f.sourceType).toLowerCase()}{" "}
            {f.kind === "failed" ? "could not be reached" : "found a change"}
          </span>
        </div>
      ))}
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
      const mins = Math.round((new Date(next.nextRunAt).getTime() - Date.now()) / 60_000);
      // An overdue nextRunAt only means the hourly cron has not picked the monitor
      // up yet: the check is pending, never "12 minutes ago".
      setLabel(mins <= 1 ? "due now" : mins < 60 ? `in ${mins} min` : `in ${Math.round(mins / 60)}h`);
    };
    compute();
    const id = setInterval(compute, 30_000);
    return () => clearInterval(id);
  }, [next.nextRunAt]);

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
