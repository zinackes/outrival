import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runScrapeAiVisibility } from "../core/scrape-ai-visibility";

// Thin Trigger.dev wrapper — the job body lives in ../core/scrape-ai-visibility
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const scrapeAiVisibilityJob = task({
  id: "scrape-ai-visibility",
  maxDuration: 300,
  retry: { maxAttempts: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 15000, factor: 2 },
  run: asTriggerRun(runScrapeAiVisibility),
});
