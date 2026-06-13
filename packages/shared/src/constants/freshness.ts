// Data-freshness thresholds for the per-source "how recent is this?" dots
// (patch-14). Days since the last successful scrape decide the colour; a failed
// last scrape short-circuits to "failed". Kept in @outrival/shared so the web
// dots and any server-side aggregate read the exact same numbers.

export const FRESHNESS_THRESHOLDS = {
  fresh: 7, // < 7 days  → green
  aging: 30, // 7–30 days → amber; > 30 days → red ("stale")
} as const;

export type FreshnessLevel = "fresh" | "aging" | "stale" | "failed";

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

/**
 * Classify how recent a scraped source is. A failed last scan always wins (the
 * data on screen is whatever the previous success left, so we warn regardless of
 * age). No date → treated as stale. Pure + side-effect-free: reused by the
 * per-section dots, the global competitor dot, and any aggregate.
 */
export function computeFreshness(
  lastScrapedAt: string | Date | null | undefined,
  status: "success" | "failed" | null | undefined,
): FreshnessLevel {
  if (status === "failed") return "failed";
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

export interface MonitorFreshnessInput {
  lastRunAt: string | Date | null;
  lastFailedAt: string | Date | null;
}

export interface SourceFreshness {
  lastScrapedAt: string | null;
  status: "success" | "failed";
}

/**
 * Collapse several monitored sources into ONE (lastScrapedAt, status) pair for a
 * single dot: the STALEST source's last scrape wins, a failed last scan takes
 * precedence over age, and any never-run source makes the group stale (its
 * lastScrapedAt becomes null → computeFreshness returns "stale"). Returns null
 * when there is nothing to report on. Shared by the competitor list (one dot per
 * competitor) and the competitor page (one dot per section/tab).
 */
export function aggregateFreshness(
  monitors: MonitorFreshnessInput[],
): SourceFreshness | null {
  if (monitors.length === 0) return null;
  let anyFailed = false;
  let anyNeverRun = false;
  let oldest: number | null = null;
  for (const m of monitors) {
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
