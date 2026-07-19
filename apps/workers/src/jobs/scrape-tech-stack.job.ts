import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runScrapeTechStack } from "../core/scrape-tech-stack";

// Thin Trigger.dev wrapper — the job body lives in ../core/scrape-tech-stack
// (runtime neutral, shared with the pg-boss handler). Deleted at the cutover.
export const scrapeTechStackJob = task({
  id: "scrape-tech-stack",
  maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  run: asTriggerRun(runScrapeTechStack),
});
