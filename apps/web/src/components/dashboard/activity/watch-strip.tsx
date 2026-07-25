"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ActivityBucket, ActivityFinding, ActivityUpcoming } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/format-date";
import { sourceLabel } from "@/lib/source-labels";
import { competitorNameColor } from "@/lib/competitor-color";

// 24 hours of history in quarter-hour buckets, then the checks the scheduler
// already has queued. One object answers both halves of "is it still watching":
// the work done, and the work due.
const SLOTS = 96; // 24h in quarter hours
const FUTURE_MINUTES = 180;
// 24h of history against 3h of schedule, so an hour is the same width on both
// sides of now.
const PAST_PCT = 88.9;
const FUTURE_PCT = 100 - PAST_PCT;
const SLOT_PCT = PAST_PCT / SLOTS;

// Hours the user is asleep. Outrival keeps checking through them, which is most
// of the reason this page exists.
const NIGHT_FROM = 22;
const NIGHT_TO = 7;

type BarKind = "quiet" | "change" | "failed";

interface Bar {
  slot: number;
  left: number;
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
  upcoming,
  loading,
  failed,
  onRetry,
}: {
  buckets: ActivityBucket[];
  // The named findings of the window, so hovering a bar says WHICH source moved
  // rather than only that something did.
  findings: ActivityFinding[];
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

    // Attribute each finding to the bucket it happened in, so a bar can name it.
    const findingsBySlot = new Map<number, ActivityFinding[]>();
    for (const f of findings) {
      const slot = Math.floor((now - new Date(f.recordedAt).getTime()) / (15 * 60_000));
      if (slot < 0 || slot >= SLOTS) continue;
      const list = findingsBySlot.get(slot);
      if (list) list.push(f);
      else findingsBySlot.set(slot, [f]);
    }

    const bars: Bar[] = [];
    const nightSlots: boolean[] = [];
    for (let slot = SLOTS - 1; slot >= 0; slot--) {
      // Slot s covers [now - (s+1)·15min, now - s·15min).
      const start = new Date(now - (slot + 1) * 15 * 60_000);
      const end = new Date(now - slot * 15 * 60_000);
      const hour = start.getHours();
      nightSlots[SLOTS - 1 - slot] = hour >= NIGHT_FROM || hour < NIGHT_TO;

      const b = bySlot.get(slot);
      const left = ((SLOTS - 1 - slot) / SLOTS) * PAST_PCT;
      const common = { slot, left, start, end, findings: findingsBySlot.get(slot) ?? [] };
      if (!b || b.checks === 0) {
        // An observed zero keeps a stub, so a quarter hour with nothing due reads
        // as "nothing due" and not as a hole in the record.
        bars.push({ ...common, height: 3, kind: "quiet", checks: 0 });
        continue;
      }
      const kind = bucketKind(b);
      bars.push({
        ...common,
        height: kind === "quiet" ? Math.min(6 + b.checks * 8, 26) : 32,
        kind,
        checks: b.checks,
      });
    }

    // Contiguous night runs, so the shading is one band per night rather than 96
    // adjacent cells (and survives a window that spans two of them).
    const bands: { left: number; width: number; slots: number }[] = [];
    let i = 0;
    while (i < SLOTS) {
      if (!nightSlots[i]) {
        i++;
        continue;
      }
      const start = i;
      while (i < SLOTS && nightSlots[i]) i++;
      bands.push({ left: start * SLOT_PCT, width: (i - start) * SLOT_PCT, slots: i - start });
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

    const axis = [24, 18, 12, 6, 0].map((hoursAgo) =>
      formatTime(new Date(now - hoursAgo * 3_600_000), { hour: "numeric", minute: "2-digit" }),
    );

    const checks = buckets.reduce((n, b) => n + b.checks, 0);
    const findingCount = buckets.reduce((n, b) => n + b.changes + b.failures, 0);

    return { bars, bands, widest, scheduled, axis, checks, findingCount };
  }, [buckets, findings, upcoming, now]);

  // One shared cursor rather than 96 hover targets: the pointer's x resolves to a
  // bucket, which is both cheaper than a tooltip root per bar and easier to hit
  // than a 7px column.
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
      const index = Math.min(SLOTS - 1, Math.max(0, Math.floor((x / pastWidth) * SLOTS)));
      setHovered(SLOTS - 1 - index);
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
            ? `${model.checks} checks over the last 24 hours, ${model.findingCount} of them found something. Use the arrow keys to read a quarter hour at a time.`
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
                {model.widest === band && band.slots >= 12 && (
                  <span className="absolute left-1/2 top-0.5 -translate-x-1/2 font-mono text-meta text-muted-foreground">
                    overnight
                  </span>
                )}
              </div>
            ))}

            {/* The hovered quarter hour, marked behind the bars so the bar itself
                stays the brightest thing in its own column. */}
            {hoveredBar && (
              <div
                className="absolute inset-y-0 bg-surface-3"
                style={{ left: `${hoveredBar.left}%`, width: `${SLOT_PCT}%` }}
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
                    (bar.height <= 3
                      ? "bg-border"
                      : hoveredBar?.slot === bar.slot
                        ? "bg-foreground"
                        : "bg-border-strong"),
                )}
                style={{
                  left: `${bar.left}%`,
                  width: `calc(${SLOT_PCT}% - 2px)`,
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
                  style={{ left: `calc(${bar.left + SLOT_PCT / 2}% - 2.5px)`, bottom: "36px" }}
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
          <div className="flex justify-between" style={{ flex: `0 0 ${PAST_PCT}%` }}>
            {model.axis.map((label, i) => (
              <span key={i} className={cn(i % 2 === 1 && "hidden sm:inline")}>
                {label}
              </span>
            ))}
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

// What one quarter hour holds. Anchored to its own bar and clamped to the strip,
// so a bucket at either end still reads inside the page.
function BucketCard({ bar }: { bar: Bar }) {
  const centre = bar.left + SLOT_PCT / 2;
  const clamped = Math.min(88, Math.max(12, centre));
  return (
    <div
      className="pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 shadow-xs"
      style={{ left: `${clamped}%` }}
      aria-live="polite"
    >
      <div className="font-mono text-meta text-muted-foreground tabular-nums">
        {formatTime(bar.start)} to {formatTime(bar.end)}
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
