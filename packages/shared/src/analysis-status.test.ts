import { test, expect } from "bun:test";
import {
  deriveAnalysisStatus,
  ANALYSIS_SUMMARY_GRACE_MS,
  ANALYSIS_SCRAPE_TIMEOUT_MS,
  type AnalysisMonitorInput,
} from "./analysis-status";

const NOW = 1_700_000_000_000;
const anchor = (o: Partial<AnalysisMonitorInput>): AnalysisMonitorInput => ({
  lastRunAt: null,
  lastFailedAt: null,
  scrapeStartedAt: null,
  markedUnscrapable: false,
  ...o,
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

test("scraping: scrapeStartedAt is fresh and after the last terminal event", () => {
  const s = deriveAnalysisStatus(
    { hasSummary: false, anchor: anchor({ scrapeStartedAt: new Date(NOW - 10_000) }) },
    NOW,
  );
  expect(s).toEqual({ stage: "scraping", pending: true });
});

test("a stale scrapeStartedAt past the timeout is no longer 'scraping'", () => {
  const s = deriveAnalysisStatus(
    {
      hasSummary: false,
      anchor: anchor({ scrapeStartedAt: new Date(NOW - ANALYSIS_SCRAPE_TIMEOUT_MS - 1) }),
    },
    NOW,
  );
  expect(s.stage).toBe("queued");
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

test("needs_attention: markedUnscrapable short-circuits", () => {
  const s = deriveAnalysisStatus(
    {
      hasSummary: false,
      anchor: anchor({ markedUnscrapable: true, scrapeStartedAt: new Date(NOW - 5_000) }),
    },
    NOW,
  );
  expect(s).toEqual({ stage: "needs_attention", pending: false });
});

test("a re-scan in flight after a prior success reads as scraping", () => {
  const s = deriveAnalysisStatus(
    {
      hasSummary: false,
      anchor: anchor({
        lastRunAt: new Date(NOW - ANALYSIS_SUMMARY_GRACE_MS - 100_000), // old success
        scrapeStartedAt: new Date(NOW - 5_000), // fresh re-scan
      }),
    },
    NOW,
  );
  expect(s).toEqual({ stage: "scraping", pending: true });
});
