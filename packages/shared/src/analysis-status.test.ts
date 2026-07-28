import { test, expect } from "bun:test";
import {
  deriveAnalysisStatus,
  deriveScrapeActivity,
  ANALYSIS_SUMMARY_GRACE_MS,
  ANALYSIS_SCRAPE_TIMEOUT_MS,
  ANALYSIS_QUEUE_TIMEOUT_MS,
  type AnalysisMonitorInput,
} from "./analysis-status";

const NOW = 1_700_000_000_000;
const anchor = (o: Partial<AnalysisMonitorInput>): AnalysisMonitorInput => ({
  lastRunAt: null,
  lastFailedAt: null,
  scrapeStartedAt: null,
  scrapePickedUpAt: null,
  markedUnscrapable: false,
  isActive: true,
  ...o,
});

/** A scrape a worker has actually taken: both stamps set, pickup after enqueue. */
const running = (agoMs: number): Partial<AnalysisMonitorInput> => ({
  scrapeStartedAt: new Date(NOW - agoMs - 1_000),
  scrapePickedUpAt: new Date(NOW - agoMs),
});

test("ready when a summary exists, regardless of scrape state", () => {
  const s = deriveAnalysisStatus({ hasSummary: true, anchor: anchor({}) }, NOW);
  expect(s).toEqual({ stage: "ready", pending: false });
});

test("idle when there is no anchor monitor (idea/document self-product)", () => {
  const s = deriveAnalysisStatus({ hasSummary: false, anchor: null }, NOW);
  expect(s).toEqual({ stage: "idle", pending: false });
});

test("queued: seeded, never scraped, no scrape in flight", () => {
  const s = deriveAnalysisStatus({ hasSummary: false, anchor: anchor({}) }, NOW);
  expect(s).toEqual({ stage: "queued", pending: true });
});

test("scraping: a worker picked the job up", () => {
  const s = deriveAnalysisStatus({ hasSummary: false, anchor: anchor(running(10_000)) }, NOW);
  expect(s).toEqual({ stage: "scraping", pending: true });
});

// The distinction this module exists to draw: enqueued is not the same as running.
// Prod queue waits reached an hour, so calling that "scraping" told the user we
// were fetching a site nothing had opened yet.
test("queued: enqueued but no worker has taken it", () => {
  const s = deriveAnalysisStatus(
    { hasSummary: false, anchor: anchor({ scrapeStartedAt: new Date(NOW - 20 * 60_000) }) },
    NOW,
  );
  expect(s).toEqual({ stage: "queued", pending: true });
});

test("a stale pickup past the scrape timeout is no longer 'scraping'", () => {
  const s = deriveAnalysisStatus(
    {
      hasSummary: false,
      anchor: anchor(running(ANALYSIS_SCRAPE_TIMEOUT_MS + 1)),
    },
    NOW,
  );
  expect(s.stage).not.toBe("scraping");
});

// A never-scraped source stays "queued" however old the enqueue is — the hourly
// cron keeps re-enqueuing it, so it genuinely is still waiting. The ceiling is for
// the other case: a re-scan whose job died leaves a stamp nothing will ever clear,
// and past the ceiling the state the source had before must win again.
test("an enqueue older than the queue ceiling falls back to the settled state", () => {
  const s = deriveAnalysisStatus(
    {
      hasSummary: false,
      anchor: anchor({
        lastFailedAt: new Date(NOW - 2 * ANALYSIS_QUEUE_TIMEOUT_MS),
        scrapeStartedAt: new Date(NOW - ANALYSIS_QUEUE_TIMEOUT_MS - 1),
      }),
    },
    NOW,
  );
  expect(s).toEqual({ stage: "needs_attention", pending: false });
});

test("summarizing: scraped within grace, summary still missing", () => {
  const s = deriveAnalysisStatus(
    { hasSummary: false, anchor: anchor({ lastRunAt: new Date(NOW - 60_000) }) },
    NOW,
  );
  expect(s).toEqual({ stage: "summarizing", pending: true });
});

test("needs_attention: scraped long ago, summary never arrived", () => {
  const s = deriveAnalysisStatus(
    {
      hasSummary: false,
      anchor: anchor({ lastRunAt: new Date(NOW - ANALYSIS_SUMMARY_GRACE_MS - 1) }),
    },
    NOW,
  );
  expect(s).toEqual({ stage: "needs_attention", pending: false });
});

test("idle: markedUnscrapable (cascade gave up) — parked, its own surface lists it", () => {
  const s = deriveAnalysisStatus(
    {
      hasSummary: false,
      anchor: anchor({ markedUnscrapable: true, scrapeStartedAt: new Date(NOW - 5_000) }),
    },
    NOW,
  );
  expect(s).toEqual({ stage: "idle", pending: false });
});

test("idle: user paused the anchor — no nag even if the first scrape had failed", () => {
  // The reported case: sources turned off, yet the banner stuck because the derive
  // ignored isActive. A paused anchor is parked → idle, not needs_attention.
  const s = deriveAnalysisStatus(
    {
      hasSummary: false,
      anchor: anchor({ isActive: false, lastFailedAt: new Date(NOW - 8 * 60_000) }),
    },
    NOW,
  );
  expect(s).toEqual({ stage: "idle", pending: false });
});

test("needs_attention: first scrape failed, never succeeded (no more infinite 'queued')", () => {
  // The screenshot bug: homepage scrape timed out. The worker stamped lastFailedAt
  // and cleared scrapeStartedAt, nextRunAt is hours out. Must NOT read as queued.
  const s = deriveAnalysisStatus(
    {
      hasSummary: false,
      anchor: anchor({
        scrapeStartedAt: null,
        lastFailedAt: new Date(NOW - 8 * 60_000),
        lastRunAt: null,
      }),
    },
    NOW,
  );
  expect(s).toEqual({ stage: "needs_attention", pending: false });
});

test("a fresh retry after a failed first scrape reads as scraping again", () => {
  const s = deriveAnalysisStatus(
    {
      hasSummary: false,
      anchor: anchor({
        lastFailedAt: new Date(NOW - 60_000), // earlier failure
        ...running(5_000), // user hit "Retry", a worker took it
      }),
    },
    NOW,
  );
  expect(s).toEqual({ stage: "scraping", pending: true });
});

// The retry is in the queue but not yet picked up: still pending, still visible,
// but honest about which of the two it is.
test("a retry still waiting its turn reads as queued, not as the old failure", () => {
  const s = deriveAnalysisStatus(
    {
      hasSummary: false,
      anchor: anchor({
        lastFailedAt: new Date(NOW - 60_000),
        scrapeStartedAt: new Date(NOW - 5_000),
      }),
    },
    NOW,
  );
  expect(s).toEqual({ stage: "queued", pending: true });
});

test("a recent success supersedes an older failure (summarizing, not needs_attention)", () => {
  const s = deriveAnalysisStatus(
    {
      hasSummary: false,
      anchor: anchor({
        lastFailedAt: new Date(NOW - 120_000), // older failure
        lastRunAt: new Date(NOW - 60_000), // later success, summary pending
      }),
    },
    NOW,
  );
  expect(s).toEqual({ stage: "summarizing", pending: true });
});

test("a re-scan in flight after a prior success reads as scraping", () => {
  const s = deriveAnalysisStatus(
    {
      hasSummary: false,
      anchor: anchor({
        lastRunAt: new Date(NOW - ANALYSIS_SUMMARY_GRACE_MS - 100_000), // old success
        ...running(5_000), // fresh re-scan, already picked up
      }),
    },
    NOW,
  );
  expect(s).toEqual({ stage: "scraping", pending: true });
});

// ── deriveScrapeActivity: the one reading of the two stamps every surface uses ──

test("activity: nothing enqueued reads as no activity", () => {
  expect(
    deriveScrapeActivity(
      { lastRunAt: new Date(NOW - 60_000), lastFailedAt: null, scrapeStartedAt: null, scrapePickedUpAt: null },
      NOW,
    ),
  ).toBeNull();
});

test("activity: enqueued but unclaimed is queued, not scraping", () => {
  expect(
    deriveScrapeActivity(
      {
        lastRunAt: null,
        lastFailedAt: null,
        scrapeStartedAt: new Date(NOW - 30 * 60_000),
        scrapePickedUpAt: null,
      },
      NOW,
    ),
  ).toBe("queued");
});

test("activity: a queue wait past the hour ceiling stops being reported", () => {
  expect(
    deriveScrapeActivity(
      {
        lastRunAt: null,
        lastFailedAt: null,
        scrapeStartedAt: new Date(NOW - ANALYSIS_QUEUE_TIMEOUT_MS - 1),
        scrapePickedUpAt: null,
      },
      NOW,
    ),
  ).toBeNull();
});

test("activity: a pick-up older than the request it would describe is ignored", () => {
  // A handler killed mid-flight leaves scrapePickedUpAt behind. Reading it as this
  // request's would make a freshly enqueued scrape look like nothing at all.
  expect(
    deriveScrapeActivity(
      {
        lastRunAt: null,
        lastFailedAt: null,
        scrapeStartedAt: new Date(NOW - 60_000),
        scrapePickedUpAt: new Date(NOW - ANALYSIS_SCRAPE_TIMEOUT_MS - 60_000),
      },
      NOW,
    ),
  ).toBe("queued");
});

test("activity: a terminal outcome after the request closes the window", () => {
  expect(
    deriveScrapeActivity(
      {
        lastRunAt: new Date(NOW - 10_000),
        lastFailedAt: null,
        scrapeStartedAt: new Date(NOW - 60_000),
        scrapePickedUpAt: new Date(NOW - 50_000),
      },
      NOW,
    ),
  ).toBeNull();
});
