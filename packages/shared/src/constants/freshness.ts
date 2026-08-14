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
export interface CaptureFreshness {
  /** The last capture that SUCCEEDED — when this page was actually read. */
  lastSuccessAt: string | null;
  /** The last time we tried at all, whether it worked or not. */
  lastAttemptAt: string | null;
  /**
   * Whether the most recent attempt is the most recent success. False means what is
   * on screen is the older capture and we have not been able to check it since.
   */
  verified: boolean;
  level: FreshnessLevel;
}

/**
 * The two dates a freshness line needs to be honest, out of one monitor row
 * (Véracité Intelligence v2 P4).
 *
 * "Unchanged for six days" and "not verified for six days" are different claims and
 * the surfaces made only the first one. `lastRunAt` is stamped by the SUCCESS paths
 * of scrape-monitor alone, so it is the last time the page was really read; the last
 * ATTEMPT is that or a later failure. When they differ, the page is showing a capture
 * we have since failed to reconfirm, and saying "unchanged" about it asserts
 * something nobody checked.
 *
 * `level` grades the data exactly as the dots do (a failure inside the fresh window
 * still reads fresh — see computeFreshness), so one rule drives the Sources page and
 * the "as of" chips on the dated tabs instead of two thresholds that drift.
 */
export function captureFreshness(m: MonitorFreshnessInput): CaptureFreshness {
  const successTs = m.lastRunAt ? new Date(m.lastRunAt).getTime() : null;
  const failedTs = m.lastFailedAt ? new Date(m.lastFailedAt).getTime() : null;
  const success = successTs !== null && !Number.isNaN(successTs) ? successTs : null;
  const failed = failedTs !== null && !Number.isNaN(failedTs) ? failedTs : null;
  // A failure at the same instant as a success is the failure of a LATER run whose
  // timestamps landed in the same millisecond; ties go to the failure, as they do in
  // aggregateFreshness, so the two never disagree about the same row.
  const verified = failed === null || (success !== null && success > failed);
  const attempt = Math.max(success ?? 0, failed ?? 0);
  return {
    lastSuccessAt: success === null ? null : new Date(success).toISOString(),
    lastAttemptAt: attempt === 0 ? null : new Date(attempt).toISOString(),
    verified,
    level: noSurface(m)
      ? "none"
      : computeFreshness(success === null ? null : new Date(success), verified ? "success" : "failed"),
  };
}

/**
 * The same two dates for a GROUP of sources: one dated tab, several monitors
 * (Véracité Intelligence v2 P4).
 *
 * "As of" is a claim about everything on the tab, so the date it prints is the
 * OLDEST successful read behind it — the same "stalest source wins" rule
 * aggregateFreshness uses for the dot, so the chip and the dot can never disagree.
 * One source failing since its last success is enough to drop `verified`: part of
 * the tab is then frozen, and that is exactly what the degraded variant says.
 *
 * A source that has never been read leaves the group undated rather than borrowing
 * a sibling's capture. Surfaces the competitor doesn't have are left out, as
 * everywhere else. Returns null when there is nothing to date.
 */
export function aggregateCaptureFreshness(
  monitors: MonitorFreshnessInput[],
): CaptureFreshness | null {
  const parts = monitors.filter((m) => !noSurface(m)).map(captureFreshness);
  if (parts.length === 0) return null;
  let oldestSuccess: number | null = null;
  let latestAttempt: number | null = null;
  let neverRead = false;
  let verified = true;
  for (const p of parts) {
    if (!p.verified) verified = false;
    if (p.lastSuccessAt === null) neverRead = true;
    else {
      const ts = new Date(p.lastSuccessAt).getTime();
      oldestSuccess = oldestSuccess === null ? ts : Math.min(oldestSuccess, ts);
    }
    if (p.lastAttemptAt !== null) {
      const ts = new Date(p.lastAttemptAt).getTime();
      latestAttempt = latestAttempt === null ? ts : Math.max(latestAttempt, ts);
    }
  }
  const success = neverRead ? null : oldestSuccess;
  return {
    lastSuccessAt: success === null ? null : new Date(success).toISOString(),
    lastAttemptAt: latestAttempt === null ? null : new Date(latestAttempt).toISOString(),
    verified,
    level: computeFreshness(
      success === null ? null : new Date(success),
      verified ? "success" : "failed",
    ),
  };
}

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
