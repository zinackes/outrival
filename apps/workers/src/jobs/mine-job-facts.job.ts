import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runMineJobFacts } from "../core/mine-job-facts";

// Thin Trigger.dev wrapper — the job body lives in ../core/mine-job-facts
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const mineJobFactsJob = task({
  id: "mine-job-facts",
  maxDuration: 300,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  run: asTriggerRun(runMineJobFacts),
});
