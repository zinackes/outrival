import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { scrapeMonitorQueue } from "../lib/scrape-queues";
import { runScrapeMonitor, onScrapeMonitorFailure } from "../core/scrape-monitor";

// Thin Trigger.dev wrapper — the job body lives in ../core/scrape-monitor (runtime
// neutral, shared with the pg-boss handler). Deleted at the Trigger cutover (Phase 7).
export const scrapeMonitorJob = task({
  id: "scrape-monitor",
  // Chromium (lazy-imported Patchright) OOMs on the default 0.5 GB machine for
  // heavy pages — surfaced as TASK_EXECUTION_ABORTED. 2 GB is safe.
  machine: "medium-1x",
  // Fast lane (default). schedule-scraping reroutes learned-slow monitors (L3/L4)
  // to the bounded slow lane — see lib/scrape-queues.ts. Each run is an isolated
  // machine, so the lane caps bound proxy burst + Trigger cost, not memory.
  queue: scrapeMonitorQueue,
  maxDuration: 300,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  run: asTriggerRun(runScrapeMonitor),
  onFailure: onScrapeMonitorFailure,
});
