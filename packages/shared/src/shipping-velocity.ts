/**
 * Reading a competitor's release cadence for the compare lens (Content Intelligence
 * v2 P5).
 *
 * The cadence SIGNAL (P1) answers "did their rate move against their own trailing
 * months". This answers a different question — "how fast does each of them ship,
 * side by side" — and it has to answer it for a roster where every competitor has
 * been tracked for a different length of time. Three rules follow from that, and
 * each one is the difference between a reading and a number that flatters whoever
 * we happened to onboard first:
 *
 *  - ONLY COMPLETE MONTHS COUNT. A month three days old, averaged against full
 *    ones, reports a freeze at every competitor on the 3rd of every month.
 *  - MONTHS BEFORE THE FIRST ENTRY WE HOLD ARE ABSENT, NOT ZERO. A feed serves its
 *    most recent N entries, so earlier months are UNOBSERVED; counting them as zero
 *    would draw a ramp at a competitor that has shipped at a flat rate for years.
 *  - UNDER TWO COMPLETE MONTHS, THERE IS NO READING. A competitor tracked for a week
 *    has not published "12 releases a month" — it has published three entries, and
 *    the lens would be charting our onboarding date as their velocity.
 *
 * PURE: no I/O, no DB, no AI.
 */

/** Complete months required before a competitor appears on the lens at all. */
export const MIN_SHIPPING_MONTHS = 2;
/** Months averaged into the headline rate. */
export const SHIPPING_WINDOW_MONTHS = 3;
/** Months drawn as bars. */
export const SHIPPING_BARS = 6;
/**
 * Observed months the PREVIOUS window needs before it can be compared against. One
 * month is a month, not a baseline, and an arrow drawn off it would call ordinary
 * variance a trend.
 */
const MIN_BASELINE_MONTHS = 2;

/** One month of releases for one competitor. `month` is "YYYY-MM". */
export interface ReleaseMonth {
  month: string;
  count: number;
}

export interface ShippingSummary {
  /** Mean entries per complete month, over up to SHIPPING_WINDOW_MONTHS. */
  perMonth: number;
  /** The same mean over the window before it, or null when it was unobserved —
   *  which removes the arrow rather than inventing a direction for it. */
  previousPerMonth: number | null;
  /** Up to SHIPPING_BARS complete months, oldest first, unobserved ones omitted. */
  months: ReleaseMonth[];
  /** Complete months we could have observed. Under MIN_SHIPPING_MONTHS → no read. */
  monthsObserved: number;
}

/** "YYYY-MM" of the month before `date`, in UTC. Internal: the scrapers package
 *  exports a sibling of this name for the cadence detector, and two of them on the
 *  same barrel would be one import away from silently picking the wrong one. */
function previousMonthKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

/** `n` months before "YYYY-MM", as "YYYY-MM". */
function monthMinus(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
}

/** Whole months between two "YYYY-MM" keys, inclusive of both ends. */
function monthSpan(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm) + 1;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Summarise one competitor's release months, or null when there is no honest
 * reading to give.
 *
 * `rows` are that competitor's counts by month; months with no entries may simply be
 * absent. `now` decides which month is still running.
 */
export function summarizeShipping(
  rows: ReadonlyArray<ReleaseMonth>,
  now: Date,
): ShippingSummary | null {
  if (rows.length === 0) return null;
  const lastComplete = previousMonthKey(now);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.month, (counts.get(r.month) ?? 0) + r.count);

  // The running month is not evidence about anything yet.
  const observedMonths = [...counts.keys()].filter((m) => m <= lastComplete).sort();
  const earliest = observedMonths[0];
  if (!earliest) return null;

  const monthsObserved = monthSpan(earliest, lastComplete);
  if (monthsObserved < MIN_SHIPPING_MONTHS) return null;

  const at = (month: string): number => counts.get(month) ?? 0;
  const window = (endMonth: string, size: number): string[] => {
    const out: string[] = [];
    for (let i = size - 1; i >= 0; i--) {
      const m = monthMinus(endMonth, i);
      // Before the first entry we hold is unobserved, and unobserved is not zero.
      if (m < earliest) continue;
      out.push(m);
    }
    return out;
  };

  const recent = window(lastComplete, SHIPPING_WINDOW_MONTHS);
  const previousEnd = monthMinus(lastComplete, SHIPPING_WINDOW_MONTHS);
  const previous = window(previousEnd, SHIPPING_WINDOW_MONTHS);

  return {
    perMonth: mean(recent.map(at)),
    previousPerMonth:
      previous.length >= MIN_BASELINE_MONTHS ? mean(previous.map(at)) : null,
    months: window(lastComplete, SHIPPING_BARS).map((month) => ({ month, count: at(month) })),
    monthsObserved,
  };
}
