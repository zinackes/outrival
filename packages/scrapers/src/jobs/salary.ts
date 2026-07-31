/**
 * Weekly salary bands and their inflection (Hiring Intelligence v2 P3).
 *
 * Pure and deterministic — no AI, no I/O. The caller reads the postings and the
 * history; everything decided here is decided from the numbers the boards printed.
 *
 * The whole point of this module is that a band is only ever computed over values
 * that are actually comparable: one department bucket, one currency, one annual
 * basis. `@outrival/shared` `normalizeAnnualSalary` owns that last part and drops
 * everything it cannot place; this module never sees an hourly rate or a
 * currency-less amount, and it never merges two currencies to make a group bigger.
 */

import { normalizeDepartment, normalizeAnnualSalary, percentile } from "@outrival/shared";
import type { DepartmentBucket } from "./departments";

/** A posting as the band aggregate sees it. */
export interface SalaryTallyInput {
  department?: string | null;
  title?: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
}

export interface SalaryBand {
  bucket: DepartmentBucket;
  /** The currency the three numbers are in. Never converted, never mixed. */
  currency: string;
  p25: number;
  p50: number;
  p75: number;
  /** How many postings the band was computed over — always displayed with it. */
  n: number;
}

/** The upsert key of a band row, and the series key everything downstream groups on. */
export function salaryBandKey(bucket: string, currency: string): string {
  return `${bucket}|${currency}`;
}

/**
 * Bands for one competitor's current stock of open roles, one per (bucket, currency).
 *
 * `unknown` is excluded: it is a data-quality bucket, not a department, and a
 * "median salary for unknown" is a number nobody can act on. Postings whose
 * compensation cannot be placed on an annual basis in a known currency simply do
 * not contribute — they are not counted in `n` either, so `n` always means "roles
 * this band was actually computed from".
 */
export function tallySalaryBands(postings: ReadonlyArray<SalaryTallyInput>): SalaryBand[] {
  const byKey = new Map<string, { bucket: DepartmentBucket; currency: string; values: number[] }>();

  for (const p of postings) {
    const normalized = normalizeAnnualSalary({
      min: p.salaryMin,
      max: p.salaryMax,
      currency: p.salaryCurrency,
      period: p.salaryPeriod,
    });
    if (!normalized) continue;
    const bucket = normalizeDepartment(p.department, null, p.title);
    if (bucket === "unknown") continue;

    const key = salaryBandKey(bucket, normalized.currency);
    const group = byKey.get(key);
    if (group) group.values.push(normalized.annualMidpoint);
    else byKey.set(key, { bucket, currency: normalized.currency, values: [normalized.annualMidpoint] });
  }

  const bands: SalaryBand[] = [];
  for (const { bucket, currency, values } of byKey.values()) {
    const sorted = [...values].sort((a, b) => a - b);
    bands.push({
      bucket,
      currency,
      p25: Math.round(percentile(sorted, 0.25) as number),
      p50: Math.round(percentile(sorted, 0.5) as number),
      p75: Math.round(percentile(sorted, 0.75) as number),
      n: sorted.length,
    });
  }
  // Stable order so a dry-run diff and a re-run read the same.
  return bands.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.currency.localeCompare(b.currency));
}

// ── inflection ──────────────────────────────────────────────────────────────

export interface BandWeekPoint {
  /** ISO-week key "YYYY-MM-DD" (Monday, UTC). */
  weekStart: string;
  p50: number;
  n: number;
}

/** One (bucket, currency) band's weekly history, ascending. */
export interface SalaryBandSeries {
  bucket: DepartmentBucket;
  currency: string;
  points: BandWeekPoint[];
}

export interface SalaryShiftOptions {
  /** Relative move of p50 that counts as a shift (default 0.15). */
  threshold?: number;
  /** Minimum postings behind a band on BOTH sides (default 3). */
  minN?: number;
  /** Trailing weeks the baseline median is taken over (default 4). */
  windowWeeks?: number;
  /**
   * Qualifying trailing weeks required. A "median of the trailing weeks" computed
   * over a single week is that week, which is a week-on-week comparison wearing a
   * baseline's clothes — and a board that posts a handful of roles moves its median
   * every time one closes.
   */
  minTrailingWeeks?: number;
}

export interface FiringBand {
  bucket: DepartmentBucket;
  currency: string;
  /** This week's band. */
  current: BandWeekPoint;
  /** Median of the qualifying trailing weeks' p50. */
  baseline: number;
  /** The weeks that formed the baseline, oldest first. */
  trailing: BandWeekPoint[];
  /** (current.p50 − baseline) / baseline. Signed: a cut is as interesting as a raise. */
  delta: number;
}

const DEFAULTS: Required<SalaryShiftOptions> = {
  threshold: 0.15,
  minN: 3,
  windowWeeks: 4,
  minTrailingWeeks: 2,
};

/** Median of an unsorted numeric array. Empty → null. */
function medianOf(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

/**
 * Bands whose p50 just moved past the threshold against their own trailing median.
 *
 * `currentWeek` is required and checked: the series is read out of storage, so
 * without it a competitor whose board stopped being scraped would keep re-comparing
 * its last captured week against ever-older history and eventually fire on a
 * baseline that has simply aged out from under it.
 */
export function detectSalaryBandShift(
  series: ReadonlyArray<SalaryBandSeries>,
  currentWeek: string,
  opts: SalaryShiftOptions = {},
): FiringBand[] {
  const { threshold, minN, windowWeeks, minTrailingWeeks } = { ...DEFAULTS, ...opts };
  const firing: FiringBand[] = [];

  for (const s of series) {
    const points = [...s.points].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    const current = points[points.length - 1];
    if (!current || current.weekStart !== currentWeek) continue;
    if (current.n < minN) continue;

    const trailing = points
      .slice(Math.max(0, points.length - 1 - windowWeeks), points.length - 1)
      .filter((p) => p.n >= minN);
    if (trailing.length < minTrailingWeeks) continue;

    const baseline = medianOf(trailing.map((p) => p.p50));
    if (baseline == null || baseline <= 0) continue;

    const delta = (current.p50 - baseline) / baseline;
    if (Math.abs(delta) < threshold) continue;

    firing.push({ bucket: s.bucket, currency: s.currency, current, baseline, trailing, delta });
  }

  // Biggest move first: the caller caps how many it emits per run.
  return firing.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

// The disclosure verdict itself lives in @outrival/shared — the API and the web app
// need the same answer from the same two numbers, and neither may import scrapers.
// Re-exported so `@outrival/scrapers/jobs-hiring` stays the single import for the
// worker's pure hiring logic, exactly like the department taxonomy above.
export {
  disclosureVerdict,
  DISCLOSURE_SHARE,
  DISCLOSURE_MIN_ROLES,
  type DisclosureVerdict,
} from "@outrival/shared";

// ── weekly reconstruction (backfill only) ───────────────────────────────────

/** ISO-week bounds [start, end) for a "YYYY-MM-DD" Monday key. */
export function weekBounds(weekStart: string): { start: Date; end: Date } {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  return { start, end: new Date(start.getTime() + 7 * 86_400_000) };
}

/**
 * Was this posting on the board at any point during the given ISO week?
 *
 * Reconstructs the past from `detected_at` / `closed_at`, which is the only history
 * of the board we hold. It is deliberately inclusive at both edges — a role opened
 * on the Friday and one closed on the Tuesday were both open that week — because
 * the alternative (only roles open for the whole week) would erase every fast-moving
 * board from its own history.
 */
export function wasActiveInWeek(
  posting: { detectedAt: Date | string; closedAt: Date | string | null },
  weekStart: string,
): boolean {
  const { start, end } = weekBounds(weekStart);
  const detected = new Date(posting.detectedAt);
  if (detected >= end) return false;
  if (posting.closedAt == null) return true;
  return new Date(posting.closedAt) > start;
}

/** The ISO-week keys of the `count` weeks ending at `latestWeek`, oldest first. */
export function weeksBack(latestWeek: string, count: number): string[] {
  const { start } = weekBounds(latestWeek);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(new Date(start.getTime() - i * 7 * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}
