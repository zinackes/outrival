// The overview pulse window: the [from, to] range every number on the rail is
// derived from, and the bucketing that turns signals into its bars.
//
// Extracted from `components/dashboard/overview.tsx` so the timezone rule below is
// testable without rendering — it is what threw React #418 on /dashboard.
//
// A "last N days" window snaps to calendar-day boundaries, and a calendar day is a
// property of the VIEWER's timezone. The server renders in UTC, the browser in the
// viewer's zone, so `lastNDays(7)` produces two windows offset by the viewer's UTC
// offset. Both sides then bucket the same signals on grids shifted by that offset,
// and a signal landing in the first hours of a day falls in a different bar on each
// side. The server HTML and the first client render disagree, and React bails out of
// hydration for the whole subtree.
//
// `lastNUtcDays` is the window both runtimes compute to the same instants whatever
// their zone, so the first paint agrees; the component adopts the viewer's own
// calendar days on mount, once "their zone" is knowable.

import type { DateRange, DatePreset } from "@/components/ui/date-range-picker";
import { formatDate } from "@/lib/format-date";

const MS_DAY = 86_400_000;

// Rolling "last N days" window anchored on UTC calendar days. Same instants in
// every timezone, which is the whole point — see the header.
export function lastNUtcDays(n: number, now: Date = new Date()): DateRange {
  const from = new Date(now.getTime() - n * MS_DAY);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(now.getTime());
  to.setUTCHours(23, 59, 59, 999);
  return { from, to };
}

// The picker's default presets, UTC-anchored. `triggerLabel` recomputes `p.range()`
// on every render and compares it to the current value, so a UTC value measured
// against local presets would print "Aug 8 – Aug 16" on the client and "Last 7 days"
// on the server. Feeding it these until mount keeps both halves on one clock.
export const UTC_PRESETS: DatePreset[] = [
  { label: "Last 7 days", range: () => lastNUtcDays(7) },
  { label: "Last 30 days", range: () => lastNUtcDays(30) },
  { label: "Last 90 days", range: () => lastNUtcDays(90) },
];

// Buckets signals across the selected [from, to] window into `buckets` equal
// slices, so the bars span the picked range rather than a fixed tail.
export function trendBuckets(
  signals: { createdAt: string }[],
  fromMs: number,
  toMs: number,
  buckets: number,
): number[] {
  const span = Math.max(1, toMs - fromMs);
  const slice = span / buckets;
  const out = new Array<number>(buckets).fill(0);
  for (const s of signals) {
    const t = new Date(s.createdAt).getTime();
    if (t < fromMs || t > toMs) continue;
    const i = Math.min(buckets - 1, Math.floor((t - fromMs) / slice));
    out[i]!++;
  }
  return out;
}

// One label per bucket for the bars' hover. A bucket is a single day while the range
// fits in MAX_BARS; past that it spans several, and the label says so rather than
// naming only its first day.
//
// `timeZone` pins the calendar the labels are read in. Left out, they read in the
// runtime's zone — right once mounted, but a UTC midnight boundary renders as the
// day before for any viewer west of Greenwich, so the pre-mount pass pins "UTC".
export function bucketLabels(
  fromMs: number,
  toMs: number,
  buckets: number,
  timeZone?: string,
): string[] {
  const day = (ms: number) =>
    formatDate(new Date(ms), { month: "short", day: "numeric", ...(timeZone && { timeZone }) });
  const slice = Math.max(1, toMs - fromMs) / buckets;
  const wide = slice > 1.5 * MS_DAY;
  return Array.from({ length: buckets }, (_, i) => {
    const start = fromMs + i * slice;
    return wide ? `${day(start)} to ${day(start + slice - MS_DAY)}` : day(start);
  });
}
