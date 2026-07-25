"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import type { ActivityDay, ActivityEvent } from "@/lib/api";
import { cn } from "@/lib/utils";
import { activityQuietDayQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { RunRow } from "./run-row";
import { dayBounds, dayKeyOf, dayLabel } from "./format";

// The log leads with the runs that FOUND something and folds the rest away. Nine
// in ten checks find nothing, so a flat feed spent most of a page on rows reading
// "No change — — —". The day's own tally states the work in full, and the quiet
// runs sit one click behind it, fetched for that day only: nothing is hidden, and
// the findings get the room.

type Filters = { competitorId?: string; sourceType?: string };

const rowKey = (e: ActivityEvent, i: number) => `${e.competitorId}-${e.recordedAt}-${i}`;

export function ActivityLog({
  events,
  days,
  foldable,
  filters,
  productId,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  events: ActivityEvent[];
  days: ActivityDay[];
  // Day tallies and the quiet fold only hold when the feed is unfiltered: the
  // summary counts every source, so pairing "38 checks" with a filtered list
  // would describe work the rows do not show.
  foldable: boolean;
  filters: Filters;
  productId?: string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const groups = useMemo(() => {
    const byDay = new Map<string, ActivityEvent[]>();
    for (const e of events) {
      const key = dayKeyOf(e.recordedAt);
      const bucket = byDay.get(key);
      if (bucket) bucket.push(e);
      else byDay.set(key, [e]);
    }

    if (!foldable) {
      return [...byDay.entries()].map(([key, rows]) => ({ key, rows, day: null }));
    }

    // Drive the outline off the day tallies, so a day whose every check was quiet
    // still appears (with its fold) instead of vanishing from a findings feed.
    // Stop at the oldest day already loaded while more pages remain, or the page
    // would print empty headers for days it has not fetched yet.
    const oldestLoaded = events.length > 0 ? dayKeyOf(events[events.length - 1]!.recordedAt) : null;
    const dayByKey = new Map(days.map((d) => [d.date, d]));
    const keys = [...new Set([...days.map((d) => d.date), ...byDay.keys()])].sort().reverse();
    const visible = hasMore && oldestLoaded ? keys.filter((k) => k >= oldestLoaded) : keys;
    return visible.map((key) => ({ key, rows: byDay.get(key) ?? [], day: dayByKey.get(key) ?? null }));
  }, [events, days, foldable, hasMore]);

  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {groups.map(({ key, rows, day }) => {
        const quiet = day
          ? Math.max(0, day.checks - day.changes - day.failures - day.firstCaptures)
          : 0;
        return (
          <section key={key} aria-label={dayLabel(key)}>
            <div className="mb-1 flex items-baseline justify-between gap-3 border-b border-border pb-1.5 pt-4 first:pt-0">
              <h3 className="text-sm font-semibold tracking-tight">{dayLabel(key)}</h3>
              {day && <DayTally day={day} />}
            </div>
            {rows.map((e, i) => {
              const k = rowKey(e, i);
              return (
                <RunRow key={k} event={e} isOpen={expanded.has(k)} onToggle={() => toggle(k)} />
              );
            })}
            {foldable && quiet > 0 && (
              <QuietFold
                dayKey={key}
                count={quiet}
                filters={filters}
                productId={productId}
                expanded={expanded}
                onToggleRow={toggle}
              />
            )}
          </section>
        );
      })}

      {hasMore && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 self-center"
          onClick={onLoadMore}
          loading={loadingMore}
        >
          Load older activity
        </Button>
      )}
    </div>
  );
}

function DayTally({ day }: { day: ActivityDay }) {
  const parts: string[] = [`${day.checks} check${day.checks === 1 ? "" : "s"}`];
  if (day.changes > 0) parts.push(`${day.changes} change${day.changes === 1 ? "" : "s"}`);
  if (day.firstCaptures > 0) parts.push(`${day.firstCaptures} first capture${day.firstCaptures === 1 ? "" : "s"}`);
  if (day.failures > 0) parts.push(`${day.failures} not reached`);
  return (
    <span className="text-dense text-muted-foreground tabular-nums">{parts.join(" · ")}</span>
  );
}

// The quiet runs of one day, fetched when the fold is opened and never before:
// most days are never opened, and the rows only exist to be auditable.
function QuietFold({
  dayKey,
  count,
  filters,
  productId,
  expanded,
  onToggleRow,
}: {
  dayKey: string;
  count: number;
  filters: Filters;
  productId?: string;
  expanded: Set<string>;
  onToggleRow: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const bounds = dayBounds(dayKey);
  const q = useQuery({
    ...activityQuietDayQuery({ key: dayKey, ...bounds }, filters, productId),
    enabled: open,
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-dense text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring sm:pl-[46px]"
      >
        <ChevronRight
          className={cn("size-3.5 shrink-0 text-text-subtle transition-transform", open && "rotate-90")}
          aria-hidden
        />
        <span>
          <span className="font-medium text-foreground tabular-nums">{count}</span> more check
          {count === 1 ? "" : "s"} found nothing new
        </span>
      </button>
      {open && q.isPending && (
        <p className="px-2 py-2 text-dense text-muted-foreground sm:pl-[61px]">Loading…</p>
      )}
      {open && q.isError && (
        <p className="px-2 py-2 text-dense text-muted-foreground sm:pl-[61px]">
          Couldn&apos;t load these checks.{" "}
          <button
            type="button"
            onClick={() => void q.refetch()}
            className="text-link underline underline-offset-2"
          >
            Retry
          </button>
        </p>
      )}
      {open &&
        q.data?.events.map((e, i) => {
          const k = `quiet-${dayKey}-${rowKey(e, i)}`;
          return <RunRow key={k} event={e} isOpen={expanded.has(k)} onToggle={() => onToggleRow(k)} />;
        })}
    </>
  );
}
