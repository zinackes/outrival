"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import type { ActivityUpcoming } from "@/lib/api";
import { cn } from "@/lib/utils";
import { feedItemMotion } from "@/lib/motion";
import { formatDate, formatTime } from "@/lib/format-date";
import { sourceLabel } from "@/lib/source-labels";
import { competitorNameColor } from "@/lib/competitor-color";
import { usePersistedOpen } from "@/hooks/use-persisted-open";

// The queue, named. The strip already draws the checks due in its next three
// hours, but almost nothing is: a daily source is scheduled a day out and a
// weekly one a week, so the future half of the strip reads as an empty page and
// the only scheduled check the page ever named was the very next one. This is
// the rest of that sentence — who gets checked, when, and on what rhythm.
//
// Read-only on purpose: making a source run sooner belongs to the source itself
// (Needs attention above, or its page), not to a list whose job is to say what
// the scheduler is already going to do.

const PREVIEW = 6;
const DAY = 86_400_000;
const OPEN_KEY = "outrival.activity.upNext.open";

type Bucket = "soon" | "today" | "tomorrow" | "later";

const BUCKET_LABEL: Record<Bucket, string> = {
  soon: "Within the hour",
  today: "Later today",
  tomorrow: "Tomorrow",
  later: "Later",
};

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Calendar days apart, counted between local midnights rather than in whole
// 24-hour spans, so a DST night (23h or 25h long) still reads as "tomorrow".
function daysApart(at: number, now: number): number {
  return Math.round((startOfDay(at) - startOfDay(now)) / DAY);
}

// An overdue nextRunAt only means the hourly cron has not picked the monitor up
// yet, so it belongs at the head of the queue, never in a past day.
function bucketOf(at: number, now: number): Bucket {
  const days = daysApart(at, now);
  if (days <= 0) return (at - now) / 60_000 < 60 ? "soon" : "today";
  if (days === 1) return "tomorrow";
  return "later";
}

function whenLabel(at: number, now: number, bucket: Bucket): string {
  if (bucket === "soon") {
    const mins = Math.round((at - now) / 60_000);
    return mins <= 1 ? "due now" : `in ${mins} min`;
  }
  // Inside a dated group the day is already stated by its header, so the row
  // only carries the clock; past tomorrow it has to name its own day.
  if (bucket === "later") {
    return `${formatDate(at, { weekday: "short", month: "short", day: "numeric" })} · ${formatTime(at)}`;
  }
  return formatTime(at);
}

export function UpNext({ upcoming }: { upcoming: ActivityUpcoming[] }) {
  // Every label here is relative to the browser's clock, so the list can only be
  // built after mount — rendering it during SSR would place "now" at request time
  // and hydrate into a different one. Redrawn every minute so an open tab keeps
  // counting down instead of freezing on the minute it was loaded.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const [open, setOpen] = usePersistedOpen(OPEN_KEY);
  const [showAll, setShowAll] = useState(false);

  const model = useMemo(() => {
    if (now == null) return null;
    const rows = upcoming.map((u) => {
      const at = new Date(u.nextRunAt).getTime();
      const bucket = bucketOf(at, now);
      return { u, at, bucket, when: whenLabel(at, now, bucket) };
    });
    return { rows, dueInADay: rows.filter((r) => r.at - now <= DAY).length };
  }, [upcoming, now]);

  if (!model) return null;

  const visible = showAll ? model.rows : model.rows.slice(0, PREVIEW);
  const hidden = model.rows.length - visible.length;

  return (
    <section className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center justify-between gap-3 border-b border-border pb-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="flex items-center gap-1.5">
          <ChevronRight
            className={cn(
              "size-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-90",
            )}
            aria-hidden
          />
          <h2 className="text-lg font-semibold leading-tight tracking-tight">Up next</h2>
        </span>
        <span className="text-dense text-muted-foreground">
          {model.rows.length === 0 ? (
            "nothing scheduled"
          ) : (
            <>
              <span className="tabular-nums">{model.dueInADay}</span> check
              {model.dueInADay === 1 ? "" : "s"} in the next 24 hours
            </>
          )}
        </span>
      </button>

      {/* 0fr to 1fr animates a height the browser measures itself, so the section
          opens smoothly without pinning a pixel height a wrapped row would break. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          {model.rows.length === 0 ? (
            <p className="py-2.5 text-dense text-muted-foreground">
              No check is scheduled. Every source is paused or waiting on its first run.
            </p>
          ) : (
            <>
              {/* The rows are the animated elements, not a wrapper around them, or
                  `last:` would match every row's only child and the hairlines
                  would all disappear. No <AnimatePresence>: rows are only ever
                  added here (by "Show all"), never filtered out, so there is no
                  exit to choreograph. */}
              {visible.map((r, i) => (
                <Fragment key={r.u.monitorId}>
                  {(i === 0 || visible[i - 1]!.bucket !== r.bucket) && (
                    <h3 className="pb-1 pt-3.5 text-dense font-medium text-muted-foreground first:pt-2">
                      {BUCKET_LABEL[r.bucket]}
                    </h3>
                  )}
                  <motion.div
                    {...feedItemMotion}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-border py-2 pl-1 transition-colors last:border-b-0 hover:bg-surface-2"
                  >
                    <span className="min-w-0 truncate text-dense">
                      <Link
                        href={
                          r.u.isSelf
                            ? "/dashboard/products"
                            : `/dashboard/competitors/${r.u.competitorId}`
                        }
                        className="font-medium hover:underline"
                        style={competitorNameColor(r.u.competitorColor)}
                      >
                        {r.u.competitorName}
                      </Link>
                      <span className="text-muted-foreground">
                        {" · "}
                        {sourceLabel(r.u.sourceType)}
                      </span>
                      {r.u.frequency && (
                        <span className="text-text-subtle">
                          {" · "}
                          {r.u.frequency}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-dense tabular-nums",
                        r.bucket === "soon" ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {r.when}
                    </span>
                  </motion.div>
                </Fragment>
              ))}

              {(hidden > 0 || showAll) && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="self-start pt-2 text-dense text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {showAll ? (
                    "Show fewer"
                  ) : (
                    <>
                      Show all <span className="tabular-nums">{model.rows.length}</span> scheduled
                      checks
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
