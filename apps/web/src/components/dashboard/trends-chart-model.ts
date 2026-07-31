import type { TrendsMarketSeries } from "@/lib/api";

/**
 * What the Trends charts plot, computed away from the rendering.
 *
 * Both charts make claims a reader will act on ("nobody moved", "this one is up
 * 21%"), and both used to make them wrong in ways only a running browser could
 * show. Keeping the arithmetic here means the claims are covered by tests instead
 * of by looking at the page.
 */

/** Raw captured value, carried alongside the plotted one so the tooltip can state both. */
export const rawKey = (competitorId: string) => `raw:${competitorId}`;
/** When that raw value was captured — a carried reading is not a fresh one. */
export const asOfKey = (competitorId: string) => `asOf:${competitorId}`;

export type ChartRow = Record<string, number>;

export interface CarriedGrid {
  /** One row per captured day across the field, keyed by epoch ms under `t`. */
  rows: ChartRow[];
  /** Evenly spaced x positions for the axis labels. */
  ticks: number[];
  /**
   * Explicit x domain. A window holding a single captured day would otherwise give
   * the time scale a zero-width domain, which is not a range anything can be
   * mapped onto — so that case is widened to a day around the capture.
   */
  domain: [number, number] | null;
  /** Epoch → the original timestamp string, so formatting never round-trips a date. */
  isoByStamp: Map<number, string>;
  /** True once the window is long enough that "Jan 5" alone is ambiguous. */
  spansYears: boolean;
}

/** Most ticks the time axis draws, whatever the capture count. */
const MAX_TICKS = 6;

/**
 * Every series given a value at every captured date, by carrying its last reading
 * forward.
 *
 * Competitors are scraped on staggered days, so a row only ever held the one or
 * two that reported that day. The line bridged the gap with `connectNulls`, but
 * the tooltip reads the payload, so hovering a plot of twelve lines named ONE of
 * them. Carrying forward is what the bridged line already claimed on screen: a
 * price, a headcount and a score hold until we next read them.
 *
 * Nothing is carried BACKWARD. Before a competitor's first capture there is no
 * reading, and inventing one would draw coverage we do not have.
 */
export function buildCarriedGrid(
  series: TrendsMarketSeries[],
  mode: "index" | "absolute",
): CarriedGrid {
  const isoByStamp = new Map<number, string>();
  for (const item of series) {
    for (const point of item.points) {
      const stamp = new Date(point.t).getTime();
      if (!Number.isFinite(stamp)) continue;
      if (!isoByStamp.has(stamp)) isoByStamp.set(stamp, point.t);
    }
  }
  const stamps = [...isoByStamp.keys()].sort((a, b) => a - b);
  const first = stamps[0];
  const last = stamps[stamps.length - 1];

  const rows: ChartRow[] = stamps.map((t) => ({ t }));
  for (const item of series) {
    const base = item.points[0]?.value;
    const observed = new Map<number, number>();
    for (const point of item.points) observed.set(new Date(point.t).getTime(), point.value);

    let carried: { value: number; at: number } | null = null;
    for (const row of rows) {
      const stamp = row.t!;
      const fresh = observed.get(stamp);
      if (fresh !== undefined) carried = { value: fresh, at: stamp };
      if (!carried) continue;
      row[item.competitorId] =
        mode === "index"
          ? base
            ? Math.round(((carried.value - base) / base) * 1000) / 10
            : 0
          : carried.value;
      row[rawKey(item.competitorId)] = carried.value;
      row[asOfKey(item.competitorId)] = carried.at;
    }
  }

  // Evenly spaced over the real span, so the labels describe elapsed time rather
  // than however many captures happened to land in one week.
  const count = Math.min(MAX_TICKS, stamps.length);
  const ticks =
    first == null || last == null
      ? []
      : count <= 1
        ? [first]
        : Array.from({ length: count }, (_, i) =>
            Math.round(first + ((last - first) * i) / (count - 1)),
          );

  const HALF_DAY = 43_200_000;
  const domain: [number, number] | null =
    first == null || last == null
      ? null
      : first === last
        ? [first - HALF_DAY, last + HALF_DAY]
        : [first, last];

  return {
    rows,
    ticks,
    domain,
    isoByStamp,
    spansYears: first != null && last != null && last - first > 300 * 86_400_000,
  };
}

/**
 * Push stacked labels apart without reordering them, then pull the overflow back
 * off the bottom edge. Input must be sorted by true y ascending; the dots stay
 * where the data puts them, only the text moves.
 */
export function decollide(ys: number[], gap: number, height: number): number[] {
  const out = [...ys];
  for (let i = 1; i < out.length; i++) {
    if (out[i]! - out[i - 1]! < gap) out[i] = out[i - 1]! + gap;
  }
  const floor = height - gap / 2;
  const last = out.length - 1;
  if (last >= 0 && out[last]! > floor) {
    out[last] = floor;
    for (let i = last - 1; i >= 0; i--) {
      if (out[i + 1]! - out[i]! < gap) out[i] = out[i + 1]! - gap;
    }
  }
  return out;
}

export interface SlopeRow {
  item: TrendsMarketSeries;
  from: number;
  to: number;
  /** Percent travelled, one decimal. */
  pct: number;
  moved: boolean;
  /**
   * Captured exactly once in this window. It has no "before", so its flat line is
   * drawn dashed: we are not claiming the price held, only that we read it once.
   */
  single: boolean;
  /** Palette slot, taken from the full roster so it survives filtering. */
  slot: number;
}

export interface SlopeModel {
  rows: SlopeRow[];
  /** Movers last, so they paint above the bundle they left. */
  drawn: SlopeRow[];
  /** Label position per row, de-collided, ordered top-down. */
  labels: Array<{ row: SlopeRow; top: number }>;
  height: number;
  y: (value: number) => number;
  ticks: number[];
  /** Carries the field's most common unit, for the axis labels. */
  axisItem: TrendsMarketSeries;
  firstDate: string | null;
  lastDate: string | null;
  movedCount: number;
  singleCount: number;
}

/** Vertical breathing room so the top and bottom dots aren't on the frame. */
const PAD = 12;
/** Minimum distance between two stacked labels, in px. */
export const LABEL_GAP = 20;
/** Height the plot gets per competitor, before the floor. */
const ROW_HEIGHT = 26;
const MIN_HEIGHT = 200;

export function buildSlopeModel(series: TrendsMarketSeries[]): SlopeModel | null {
  const rows: SlopeRow[] = [];
  series.forEach((item, slot) => {
    const first = item.points[0];
    const last = item.points[item.points.length - 1];
    if (!first || !last) return;
    const pct = first.value
      ? Math.round(((last.value - first.value) / first.value) * 1000) / 10
      : 0;
    rows.push({
      item,
      from: first.value,
      to: last.value,
      pct,
      moved: last.value !== first.value,
      single: item.points.length < 2,
      slot,
    });
  });
  if (rows.length === 0) return null;

  const values = rows.flatMap((r) => [r.from, r.to]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const height = Math.max(MIN_HEIGHT, rows.length * ROW_HEIGHT);
  // A field where every competitor sits at the same price has no range to map, so
  // it draws on the centre line rather than dividing by zero.
  const y = (value: number) =>
    span === 0 ? height / 2 : PAD + (1 - (value - min) / span) * (height - 2 * PAD);

  // Labels are laid out top-down by where their end value actually lands, which is
  // independent of the draw order.
  const ordered = [...rows].sort((a, b) => y(a.to) - y(b.to));
  const tops = decollide(
    ordered.map((r) => y(r.to)),
    LABEL_GAP,
    height,
  );
  const labels = ordered.map((row, i) => ({ row, top: tops[i]! }));

  const drawn = [...rows].sort((a, b) => Number(a.moved) - Number(b.moved));

  const byTime = series
    .flatMap((s) => s.points.map((p) => p.t))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  // The axis carries one unit, so it takes the field's most common one rather than
  // whichever competitor happens to be first: one euro-priced competitor must not
  // relabel ten dollar-priced ones.
  const unitTally = new Map<string, number>();
  for (const row of rows) {
    const unit = row.item.unit ?? "";
    unitTally.set(unit, (unitTally.get(unit) ?? 0) + 1);
  }
  const axisUnit = [...unitTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    rows,
    drawn,
    labels,
    height,
    y,
    ticks: span === 0 ? [min] : [max, min + span / 2, min],
    axisItem: { ...rows[0]!.item, unit: axisUnit || null },
    firstDate: byTime[0] ?? null,
    lastDate: byTime[byTime.length - 1] ?? null,
    movedCount: rows.filter((r) => r.moved).length,
    singleCount: rows.filter((r) => r.single).length,
  };
}
