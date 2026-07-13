/**
 * Hiring-velocity inflection detector (hiring-velocity feature).
 *
 * V1 is deliberately simple and PURE (the composite-signal card will supersede it):
 * for each department bucket, a week's open-role count is an inflection when it
 * exceeds (1 + threshold) × the trailing 4-week moving average, given at least 4
 * weeks of prior history. To fire "once per episode" — one signal when a bucket
 * crosses up, never again while it stays elevated, re-armed only after it falls
 * back below the band — we fire only when the CURRENT week is spiking and the
 * PREVIOUS week was not. That is computable from the series alone; no external
 * state. Combined with the caller's per-(week, firing-set) dedup, this gives
 * exactly one signal per episode.
 */

import type { DepartmentBucket } from "./departments";

export interface WeekPoint {
  /** ISO-week key "YYYY-MM-DD" (Monday, UTC). Sorted ascending by the caller. */
  weekStart: string;
  openCount: number;
}

export interface InflectionOptions {
  /** Spike ratio above the trailing average (env HIRING_SPIKE_THRESHOLD, default 0.5). */
  threshold: number;
  /** Trailing weeks averaged, and the minimum prior history required (default 4). */
  windowWeeks?: number;
}

export interface FiringBucket {
  bucket: DepartmentBucket;
  /** Current-week open count that crossed the band. */
  openCount: number;
  /** Trailing-window average it was compared against. */
  baselineAvg: number;
  /** openCount / baselineAvg. */
  ratio: number;
  severity: "medium" | "high";
}

// Engineering and sales openings are the sharpest read on where a competitor is
// actually spending — a build vs a go-to-market push — so an inflection there is
// high severity; every other bucket is medium. (When the composite-materiality
// card ships it owns this mapping; until then this is the single source.)
export function hiringSeverity(bucket: DepartmentBucket): "medium" | "high" {
  return bucket === "engineering" || bucket === "sales" ? "high" : "medium";
}

/**
 * Is the point at index `i` spiking vs its trailing `windowWeeks` average? False
 * when there is not enough prior history (i < windowWeeks) or the baseline is zero
 * (0 → any hire is an "∞×" spike, which is noise, not a velocity inflection).
 */
function spikingAt(points: WeekPoint[], i: number, threshold: number, windowWeeks: number): boolean {
  if (i < windowWeeks) return false;
  const window = points.slice(i - windowWeeks, i);
  const avg = window.reduce((sum, p) => sum + p.openCount, 0) / windowWeeks;
  if (avg <= 0) return false;
  const point = points[i];
  if (!point) return false;
  return point.openCount > (1 + threshold) * avg;
}

/**
 * Detect the buckets whose LATEST week just crossed the spike band. `seriesByBucket`
 * maps each bucket to its weekly points sorted ascending (one point per ISO week —
 * the caller aggregates hiring_metrics that way). Returns one entry per bucket that
 * fires this run; empty when nothing crosses.
 */
export function detectHiringInflection(
  seriesByBucket: Map<DepartmentBucket, WeekPoint[]>,
  opts: InflectionOptions,
): FiringBucket[] {
  const threshold = opts.threshold;
  const windowWeeks = opts.windowWeeks ?? 4;
  const firing: FiringBucket[] = [];

  for (const [bucket, points] of seriesByBucket) {
    if (points.length < 2) continue;
    const last = points.length - 1;
    // Fire only on the crossing week: spiking now AND not spiking last week. A
    // bucket that stays elevated does not re-fire; one that dips and re-crosses does.
    if (!spikingAt(points, last, threshold, windowWeeks)) continue;
    if (spikingAt(points, last - 1, threshold, windowWeeks)) continue;

    const window = points.slice(last - windowWeeks, last);
    const baselineAvg = window.reduce((sum, p) => sum + p.openCount, 0) / windowWeeks;
    const openCount = points[last]!.openCount;
    firing.push({
      bucket,
      openCount,
      baselineAvg,
      ratio: baselineAvg > 0 ? openCount / baselineAvg : 0,
      severity: hiringSeverity(bucket),
    });
  }

  return firing;
}
