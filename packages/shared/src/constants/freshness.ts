// Data-freshness thresholds for the per-source "how recent is this?" dots
// (patch-14). Days since the last successful scrape decide the colour; a failed
// last scrape short-circuits to "failed". Kept in @outrival/shared so the web
// dots and any server-side aggregate read the exact same numbers.

import { hasNoTargetError } from "../sources/coverage";
import type { SourceType } from "./sources";

export const FRESHNESS_THRESHOLDS = {
  fresh: 7, // < 7 days  → green
  aging: 30, // 7–30 days → amber; > 30 days → red ("stale")
} as const;

export type FreshnessLevel =
  | "fresh"
  | "aging"
  | "stale"
  | "failed"
  /** No such surface for this competitor — nothing to be fresh or stale about. */
  | "none";

// Cadence of the independent, interval-driven scans that are NOT monitors and so
// carry no monitors.nextRunAt (patch-18 tech stack, patch-31 platform): the daily
// enqueue cron picks up a competitor once its last scan is older than this. Kept
// here as the default so the worker (env override) and the API (which surfaces the
// "next scan") read the same number instead of duplicating a magic 30.
export const TECH_STACK_SCRAPE_INTERVAL_DAYS = 30;

/**
 * Next scan timestamp for an interval-driven (non-monitor) source: last scan +
 * interval. Returns null when never scanned — the daily enqueue cron will pick it
 * up within ~24h, which the UI words as an ETA rather than a date. Pure.
 */
export function computeNextScanAt(
  lastScrapedAt: string | Date | null | undefined,
  intervalDays: number,
): string | null {
  if (!lastScrapedAt) return null;
  const ts =
    lastScrapedAt instanceof Date
      ? lastScrapedAt.getTime()
      : new Date(lastScrapedAt).getTime();
  if (Number.isNaN(ts)) return null;
  return new Date(ts + intervalDays * 86_400_000).toISOString();
}

/** Age alone, with no successful capture read as the oldest thing there is. */
function gradeByAge(lastScrapedAt: string | Date | null | undefined): FreshnessLevel {
  if (!lastScrapedAt) return "stale";
  const ts =
    lastScrapedAt instanceof Date
      ? lastScrapedAt.getTime()
      : new Date(lastScrapedAt).getTime();
  if (Number.isNaN(ts)) return "stale";
  const days = (Date.now() - ts) / 86_400_000;
  if (days < FRESHNESS_THRESHOLDS.fresh) return "fresh";
  if (days < FRESHNESS_THRESHOLDS.aging) return "aging";
  return "stale";
}

/**
 * Classify how recent a scraped source is. No date → treated as stale. Pure +
 * side-effect-free: reused by the per-section dots, the global competitor dot, and
 * any aggregate.
 *
 * A failed last scan grades the DATA, not the attempt. What is on screen is
 * whatever the last success left, so while that capture is still inside the fresh
 * window the page is showing current data and the dot says so. A critical "Last
 * scan failed" pastille over a full, week-old timeline read as an outage the user
 * could neither confirm nor act on — one of four folded sources failing was enough
 * to paint the whole tab red. Once the frozen data ages out of the fresh window the
 * failure IS the reason it is stale, and it takes the dot back.
 */
export function computeFreshness(
  lastScrapedAt: string | Date | null | undefined,
  status: FreshnessStatus | null | undefined,
): FreshnessLevel {
  // Ranked above "failed" and above age: a surface the competitor doesn't have has
  // no age to grade, and grading it anyway is what painted an absent source green.
  if (status === "not_available") return "none";
  const level = gradeByAge(lastScrapedAt);
  if (status === "failed") return level === "fresh" ? "fresh" : "failed";
  return level;
}

export interface MonitorFreshnessInput {
  lastRunAt: string | Date | null;
  lastFailedAt: string | Date | null;
  /**
   * Both read together to recognise a "this competitor has no such surface"
   * verdict. Optional: a caller with no diagnosis to offer gets the old behaviour.
   */
  sourceType?: string;
  lastError?: string | null;
}

/** What a freshness dot is reporting on. */
export type FreshnessStatus =
  | "success"
  | "failed"
  /** Every source behind this dot came back "no such surface". Never a gap. */
  | "not_available";

export interface SourceFreshness {
  lastScrapedAt: string | null;
  status: FreshnessStatus;
}

/** Whether this monitor's last run recorded that the surface doesn't exist. */
function noSurface(m: MonitorFreshnessInput): boolean {
  // The cast is safe by construction: hasNoTargetError only looks the key up in a
  // Partial map and returns false when it isn't there, and the DB hands the API a
  // plain string for this column (same cast as `coverageOf` in apps/api).
  return m.sourceType != null && hasNoTargetError(m.sourceType as SourceType, m.lastError);
}

/**
 * Collapse several monitored sources into ONE (lastScrapedAt, status) pair for a
 * single dot: the STALEST source's last scrape wins, a failed last scan takes
 * precedence over age, and any never-run source makes the group stale (its
 * lastScrapedAt becomes null → computeFreshness returns "stale"). Returns null
 * when there is nothing to report on. Shared by the competitor list (one dot per
 * competitor) and the competitor page (one dot per section/tab).
 *
 * Sources the competitor doesn't have are left OUT of the fold. A "no such surface"
 * verdict is recorded as a benign skip — it stamps lastRunAt and clears the failure
 * columns exactly like a real capture — so counting it made a dot claim freshly
 * collected data for a page that does not exist. When every source behind the dot is
 * in that state there is no freshness to report at all, and the dot says so instead
 * of going green.
 */
export function aggregateFreshness(
  monitors: MonitorFreshnessInput[],
): SourceFreshness | null {
  if (monitors.length === 0) return null;
  const collectible = monitors.filter((m) => !noSurface(m));
  if (collectible.length === 0) return { lastScrapedAt: null, status: "not_available" };
  let anyFailed = false;
  let anyNeverRun = false;
  let oldest: number | null = null;
  for (const m of collectible) {
    const run = m.lastRunAt ? new Date(m.lastRunAt).getTime() : null;
    if (run === null || Number.isNaN(run)) anyNeverRun = true;
    else oldest = oldest === null ? run : Math.min(oldest, run);
    const failedTs = m.lastFailedAt ? new Date(m.lastFailedAt).getTime() : null;
    if (failedTs !== null && !Number.isNaN(failedTs) && (run === null || failedTs >= run)) {
      anyFailed = true;
    }
  }
  const lastScrapedAt =
    !anyNeverRun && oldest !== null ? new Date(oldest).toISOString() : null;
  return { lastScrapedAt, status: anyFailed ? "failed" : "success" };
}
