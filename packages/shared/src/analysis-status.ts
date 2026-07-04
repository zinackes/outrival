// Derived "where is the first AI analysis at?" status for a competitor (or the
// self-product). A freshly added competitor is scraped, then summarized by AI —
// `competitors.aiSummary` is the readiness proxy (null = still working). Between
// the add and the summary landing, the UI otherwise shows a static "not generated
// yet" with no sense of progress. This pure deriver turns the columns we already
// have (the anchor homepage monitor's scrape state + whether a summary exists)
// into a coarse pipeline stage the web can render and poll on. No new storage.

export type AnalysisStage =
  // Seeded, waiting on its first scrape (the hourly cron, or a force-trigger that
  // hasn't stamped scrapeStartedAt yet).
  | "queued"
  // A scrape is actively in flight (scrapeStartedAt is fresh).
  | "scraping"
  // Scraped at least once, AI summary still pending (the summary job runs after
  // the homepage scrape completes).
  | "summarizing"
  // Summary present — nothing in flight.
  | "ready"
  // The scrape is blocked (markedUnscrapable) or the summary never arrived well
  // past its grace window — the user should retry / look at the source.
  | "needs_attention"
  // Nothing to analyze (e.g. an idea/document self-product with no live URL → no
  // homepage monitor). The caller renders normal content, no progress affordance.
  | "idle";

export interface AnalysisMonitorInput {
  lastRunAt: string | Date | null;
  lastFailedAt: string | Date | null;
  scrapeStartedAt: string | Date | null;
  markedUnscrapable: boolean;
  // Whether the anchor source is still switched on. An off source (user-paused, or
  // auto-paused via markedUnscrapable) is parked — nothing in flight to flag.
  isActive: boolean;
}

export interface AnalysisStatusInput {
  // Whether competitors.aiSummary is set (the AI-output readiness proxy).
  hasSummary: boolean;
  // The anchor monitor whose scrape feeds the AI summary — the homepage monitor.
  // Null when there is nothing scrapeable, which maps to "idle".
  anchor: AnalysisMonitorInput | null;
}

export interface AnalysisStatus {
  stage: AnalysisStage;
  // True while the UI should keep polling for the summary to land.
  pending: boolean;
}

// A scrape's scrapeStartedAt is treated as "in progress" for this long before we
// stop trusting a stale stamp (mirrors the web POLL_TIMEOUT_MS / my-product SCAN
// timeout so the three never disagree on what "currently scraping" means).
export const ANALYSIS_SCRAPE_TIMEOUT_MS = 5 * 60 * 1000;

// After a successful scrape, how long the summary may take before we stop calling
// it "summarizing" and flag it as needing attention. The summary job is fast on
// the happy path but can queue behind others / fail over slowly; 30 min is a
// generous ceiling that still catches a genuinely stuck (failed) summary.
export const ANALYSIS_SUMMARY_GRACE_MS = 30 * 60 * 1000;

function toMs(v: string | Date | null): number | null {
  if (!v) return null;
  const ts = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(ts) ? null : ts;
}

/**
 * Map (hasSummary, anchor scrape state) → a coarse analysis stage. Pure: takes
 * `nowMs` so it's deterministic and testable. Shared by the API (competitor list /
 * my-product payloads) and the web (competitor detail card).
 */
export function deriveAnalysisStatus(
  input: AnalysisStatusInput,
  nowMs: number,
): AnalysisStatus {
  if (input.hasSummary) return { stage: "ready", pending: false };

  const a = input.anchor;
  if (!a) return { stage: "idle", pending: false };

  // The anchor source is off — either the user paused it or the cascade gave up
  // (markedUnscrapable, which still lists it in the dedicated unscrapable surface).
  // Either way it's parked: nothing is in flight, so don't nag with the "needs
  // attention" banner. Only an *active* anchor can be queued / scraping / stuck.
  if (!a.isActive || a.markedUnscrapable) return { stage: "idle", pending: false };

  const lastRun = toMs(a.lastRunAt);
  const lastFailed = toMs(a.lastFailedAt);
  const started = toMs(a.scrapeStartedAt);

  // A scrape is in flight only while its start stamp is fresh AND newer than the
  // last terminal event — a success or a failure both close the in-flight window.
  const scrapingNow =
    started !== null &&
    started > Math.max(lastRun ?? 0, lastFailed ?? 0) &&
    nowMs - started < ANALYSIS_SCRAPE_TIMEOUT_MS;
  if (scrapingNow) return { stage: "scraping", pending: true };

  // The anchor's most recent terminal event is a failure: on a settled failure the
  // worker stamps lastFailedAt, clears scrapeStartedAt and pushes nextRunAt hours
  // out. This is the stuck state the user actually sees — without this branch a
  // first scrape that timed out falls through to "queued" and spins forever with no
  // visible way out. Flag it so the UI shows the actionable retry instead.
  if (lastFailed !== null && lastFailed >= (lastRun ?? 0)) {
    return { stage: "needs_attention", pending: false };
  }

  if (lastRun !== null) {
    // Scraped at least once, no failure since; the summary is what we await now.
    if (nowMs - lastRun <= ANALYSIS_SUMMARY_GRACE_MS) {
      return { stage: "summarizing", pending: true };
    }
    return { stage: "needs_attention", pending: false };
  }

  // Seeded, first scrape hasn't started or finished yet.
  return { stage: "queued", pending: true };
}
