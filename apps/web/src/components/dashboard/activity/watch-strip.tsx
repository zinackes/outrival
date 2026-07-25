"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ActivityBucket, ActivityUpcoming } from "@/lib/api";
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
  title: string;
}

function bucketKind(b: ActivityBucket): BarKind {
  if (b.failures > 0) return "failed";
  if (b.changes > 0) return "change";
  return "quiet";
}

function barTitle(start: Date, b: ActivityBucket, kind: BarKind): string {
  const when = formatTime(start);
  const checks = `${b.checks} check${b.checks > 1 ? "s" : ""}`;
  if (kind === "failed") return `${when} · ${checks}, one could not be reached`;
  if (kind === "change") return `${when} · ${checks}, one found a change`;
  return `${when} · ${checks}`;
}

export function WatchStrip({
  buckets,
  upcoming,
  loading,
  failed,
  onRetry,
}: {
  buckets: ActivityBucket[];
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

    const bars: Bar[] = [];
    const nightSlots: boolean[] = [];
    for (let slot = SLOTS - 1; slot >= 0; slot--) {
      // Slot s covers [now - (s+1)·15min, now - s·15min).
      const start = new Date(now - (slot + 1) * 15 * 60_000);
      const hour = start.getHours();
      nightSlots[SLOTS - 1 - slot] = hour >= NIGHT_FROM || hour < NIGHT_TO;

      const b = bySlot.get(slot);
      const left = ((SLOTS - 1 - slot) / SLOTS) * PAST_PCT;
      if (!b || b.checks === 0) {
        // An observed zero keeps a stub, so a quarter hour with nothing due reads
        // as "nothing due" and not as a hole in the record.
        bars.push({ slot, left, height: 3, kind: "quiet", title: `${formatTime(start)} · no check due` });
        continue;
      }
      const kind = bucketKind(b);
      const height = kind === "quiet" ? Math.min(6 + b.checks * 8, 26) : 32;
      bars.push({ slot, left, height, kind, title: barTitle(start, b, kind) });
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
    const findings = buckets.reduce((n, b) => n + b.changes + b.failures, 0);

    return { bars, bands, widest, scheduled, axis, checks, findings };
  }, [buckets, upcoming, now]);

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
                  <span className="tabular-nums">{model.findings}</span> finding
                  {model.findings === 1 ? "" : "s"}
                </>
              )}
            </>
          )}
        </span>
        {next && <NextCheck next={next} />}
      </div>

      <div className="relative h-16 border-b border-border">
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

            {model.bars.map((bar) => (
              <span
                key={bar.slot}
                title={bar.title}
                className={cn(
                  "absolute bottom-0 rounded-t-[1.5px]",
                  bar.kind === "change" && "bg-foreground",
                  bar.kind === "failed" && "bg-critical",
                  bar.kind === "quiet" && (bar.height <= 3 ? "bg-border" : "bg-border-strong"),
                )}
                style={{
                  left: `${bar.left}%`,
                  width: `calc(${SLOT_PCT}% - 2px)`,
                  height: `${bar.height}px`,
                }}
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
