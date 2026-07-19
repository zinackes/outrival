import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runExtractJobs } from "../core/extract-jobs";

// Thin Trigger.dev wrapper — the job body lives in ../core/extract-jobs
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const extractJobsJob = task({
  id: "extract-jobs",
  maxDuration: 180,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  run: asTriggerRun(runExtractJobs),
});
