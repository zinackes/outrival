/**
 * Shipping-velocity inflection detector (Content Intelligence v2 P1).
 *
 * How often a competitor ships is a fact their changelog states outright and that
 * nothing in the product read: every release entry produced a diff, a paragraph
 * and no memory. With `content_items` there is finally a series to count, so
 * "they went from 4 releases a month to 12" — or to zero — becomes a claim with
 * arithmetic behind it.
 *
 * Three deliberate constraints, each of which exists to stop a false alarm:
 *
 *  1. COMPLETE MONTHS ONLY. The caller passes months that have ended. Comparing a
 *     month that is three days old against three full ones would report a product
 *     freeze at every competitor on the 3rd of the month, every month.
 *  2. NO MONTH BEFORE THE FIRST ITEM WE HOLD. A feed serves its most recent N
 *     entries, so the months before its horizon read as zero when what they really
 *     are is unobserved. Counting them would make the current month look like an
 *     acceleration on a competitor that has shipped at a flat rate for years.
 *  3. ONE SIGNAL PER EPISODE. Fire on the month that CROSSES the band, not on
 *     every month that stays across it — the same crossing rule the hiring
 *     velocity detector uses, computable from the series with no external state.
 *
 * PURE: no I/O, no DB, no AI.
 */

export interface MonthPoint {
  /** "YYYY-MM", UTC. Ascending, dense (zero-filled) — the caller builds it. */
  month: string;
  count: number;
}

export interface VelocityOptions {
  /** Relative move against the trailing average that fires (env, default 0.5). */
  threshold: number;
  /** Trailing months averaged, and the minimum history required (default 3). */
  baselineMonths?: number;
  /** Items the trailing window must total before it can be a baseline at all. */
  minBaselineItems?: number;
}

export interface VelocityShift {
  /** The complete month that crossed. */
  month: string;
  count: number;
  baselineAvg: number;
  /** count / baselineAvg. */
  ratio: number;
  direction: "accelerating" | "slowing";
  /** The months the baseline was taken over, oldest first — the block prints them. */
  baseline: MonthPoint[];
}

const DEFAULT_BASELINE_MONTHS = 3;
const DEFAULT_MIN_BASELINE_ITEMS = 8;

/** Is the point at `i` outside its trailing band, and is that band trustworthy? */
function shiftAt(
  months: MonthPoint[],
  i: number,
  earliestMonth: string,
  threshold: number,
  baselineMonths: number,
  minBaselineItems: number,
): { avg: number; ratio: number; direction: VelocityShift["direction"] } | null {
  if (i < baselineMonths) return null;
  const window = months.slice(i - baselineMonths, i);
  // Constraint 2: a window that reaches back to (or past) the month our oldest
  // item falls in is counting our blindness as their silence.
  if (window.some((p) => p.month <= earliestMonth)) return null;

  const total = window.reduce((sum, p) => sum + p.count, 0);
  if (total < minBaselineItems) return null;

  const avg = total / baselineMonths;
  if (avg <= 0) return null;
  const point = months[i];
  if (!point) return null;

  const ratio = point.count / avg;
  if (ratio >= 1 + threshold) return { avg, ratio, direction: "accelerating" };
  if (ratio <= 1 - threshold) return { avg, ratio, direction: "slowing" };
  return null;
}

/**
 * The shift the LATEST complete month just crossed into, or null.
 *
 * `earliestMonth` is the "YYYY-MM" of the oldest item held for this competitor —
 * the left edge of what we can honestly count.
 */
export function detectShippingVelocityShift(
  months: MonthPoint[],
  earliestMonth: string,
  opts: VelocityOptions,
): VelocityShift | null {
  const baselineMonths = opts.baselineMonths ?? DEFAULT_BASELINE_MONTHS;
  const minBaselineItems = opts.minBaselineItems ?? DEFAULT_MIN_BASELINE_ITEMS;
  if (months.length < baselineMonths + 1) return null;

  const last = months.length - 1;
  const now = shiftAt(months, last, earliestMonth, opts.threshold, baselineMonths, minBaselineItems);
  if (!now) return null;

  // Constraint 3: the month before must not already have been in the same state,
  // or a sustained ramp re-announces itself every month while it lasts.
  const before = shiftAt(
    months,
    last - 1,
    earliestMonth,
    opts.threshold,
    baselineMonths,
    minBaselineItems,
  );
  if (before && before.direction === now.direction) return null;

  return {
    month: months[last]!.month,
    count: months[last]!.count,
    baselineAvg: now.avg,
    ratio: now.ratio,
    direction: now.direction,
    baseline: months.slice(last - baselineMonths, last),
  };
}

/**
 * Build the dense ascending month series the detector needs from sparse counts.
 *
 * Months with no release are REAL zeros inside the observed range — that is the
 * whole point of a shipping-cadence read — so the gaps are filled rather than
 * skipped. `through` is the last complete month the caller wants counted.
 */
export function buildMonthSeries(
  counts: ReadonlyArray<{ month: string; count: number }>,
  from: string,
  through: string,
): MonthPoint[] {
  const byMonth = new Map(counts.map((c) => [c.month, c.count]));
  const out: MonthPoint[] = [];
  let cursor = from;
  // Bounded by construction (cursor only moves forward), with a hard stop so a
  // malformed bound can never spin.
  for (let guard = 0; cursor <= through && guard < 240; guard++) {
    out.push({ month: cursor, count: byMonth.get(cursor) ?? 0 });
    cursor = nextMonth(cursor);
  }
  return out;
}

/** "2026-12" → "2027-01". */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** The "YYYY-MM" of the month before the one `date` falls in, UTC. */
export function previousMonthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth(); // 0-based: this IS the previous month, 1-based
  return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, "0")}`;
}
