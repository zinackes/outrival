import type { TrendsMarketSeries } from "@/lib/api";
import { robustExtent } from "@/lib/robust-scale";

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
}

/**
 * A pointer from one line's end dot to the label that names it.
 *
 * `decollide` pushes stacked labels apart, so in a bundle a label can sit tens of
 * pixels off the line it belongs to — and the reader has no way to tell which is
 * which. Emitted only where the label actually moved: a leader on a label already at
 * its own height points at nothing and is pure clutter, which in the common case
 * (few competitors, no collisions) means none are drawn at all.
 */
export interface SlopeLeader {
  competitorId: string;
  /** Where the line ends. */
  endY: number;
  /** Where its label ended up after de-collision. */
  labelY: number;
}

export interface SlopeModel {
  rows: SlopeRow[];
  /** Movers last, so they paint above the bundle they left. */
  drawn: SlopeRow[];
  /** Label position per row, de-collided, ordered top-down. */
  labels: Array<{ row: SlopeRow; top: number }>;
  leaders: SlopeLeader[];
  height: number;
  y: (value: number) => number;
  /** Bottom and top of the ladder in force — outliers trimmed unless `full`. */
  min: number;
  max: number;
  /** The ladder that would hold every price, for the way back to the true spread. */
  fullMin: number;
  fullMax: number;
  /** True once trimming would actually change the ladder — the toggle's own gate. */
  trimmable: boolean;
  /** Competitors with at least one endpoint pinned to an edge of the ladder. */
  clippedCount: number;
  /** Whether a value is off the ladder, and which way — the UI marks the dot. */
  outside: (value: number) => "above" | "below" | null;
  ticks: number[];
  /** Carries the field's most common unit, for the axis labels. */
  axisItem: TrendsMarketSeries;
  firstDate: string | null;
  lastDate: string | null;
  movedCount: number;
  singleCount: number;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/** Vertical breathing room so the top and bottom dots aren't on the frame. */
const PAD = 12;
/** Minimum distance between two stacked labels, in px. */
export const LABEL_GAP = 20;
/** Height the plot gets per competitor, before the floor. */
const ROW_HEIGHT = 26;
const MIN_HEIGHT = 200;

export function buildSlopeModel(
  series: TrendsMarketSeries[],
  opts: {
    /**
     * Scale to the whole spread, outliers and all. The way back to the true
     * distances, for when the gap between $12 and $499 IS what the reader came for.
     */
    full?: boolean;
  } = {},
): SlopeModel | null {
  const rows: SlopeRow[] = [];
  for (const item of series) {
    const first = item.points[0];
    const last = item.points[item.points.length - 1];
    if (!first || !last) continue;
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
    });
  }
  if (rows.length === 0) return null;

  const values = rows.flatMap((r) => [r.from, r.to]);
  // One $499 enterprise plan against six $10 seat prices owns the whole ladder and
  // leaves the other six inside two pixels — measured: at 50× the median, two end
  // dots land 0.14px apart and a real +22.7% move draws 0.9px of travel. So the
  // ladder is scaled to the readable range, the outlier is drawn pinned to the edge
  // and MARKED, and its true price stays on its own label. Same rule the compare
  // price lens has always used.
  const extent = robustExtent(values)!;
  const min = opts.full ? extent.fullMin : extent.min;
  const max = opts.full ? extent.fullMax : extent.max;
  const span = max - min;
  const height = Math.max(MIN_HEIGHT, rows.length * ROW_HEIGHT);
  // A field where every competitor sits at the same price has no range to map, so
  // it draws on the centre line rather than dividing by zero. Anything off the
  // ladder is pinned to its edge rather than drawn off the plot: a label floating
  // above the chart names nothing, and the pinned dot is what the marker points at.
  const y = (value: number) =>
    span === 0
      ? height / 2
      : PAD + (1 - (clamp(value, min, max) - min) / span) * (height - 2 * PAD);
  const outside = (value: number): "above" | "below" | null =>
    value > max ? "above" : value < min ? "below" : null;

  // Labels are laid out top-down by where their end value actually lands, which is
  // independent of the draw order.
  const ordered = [...rows].sort((a, b) => y(a.to) - y(b.to));
  const tops = decollide(
    ordered.map((r) => y(r.to)),
    LABEL_GAP,
    height,
  );
  const labels = ordered.map((row, i) => ({ row, top: tops[i]! }));

  // Sub-pixel drift is not a collision, so a label the de-collision left alone gets
  // no pointer.
  const leaders: SlopeLeader[] = labels
    .filter(({ row, top }) => Math.abs(top - y(row.to)) > 1)
    .map(({ row, top }) => ({
      competitorId: row.item.competitorId,
      endY: y(row.to),
      labelY: top,
    }));

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
    leaders,
    height,
    y,
    min,
    max,
    fullMin: extent.fullMin,
    fullMax: extent.fullMax,
    trimmable: extent.clippedCount > 0,
    clippedCount: rows.filter((r) => outside(r.from) !== null || outside(r.to) !== null).length,
    outside,
    ticks: span === 0 ? [min] : [max, min + span / 2, min],
    axisItem: { ...rows[0]!.item, unit: axisUnit || null },
    firstDate: byTime[0] ?? null,
    lastDate: byTime[byTime.length - 1] ?? null,
    movedCount: rows.filter((r) => r.moved).length,
    singleCount: rows.filter((r) => r.single).length,
  };
}
