import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { summaryQueue } from "../lib/queues";
import { runRefreshCompetitorSummary } from "../core/refresh-competitor-summary";

// Thin Trigger.dev wrapper — the job body lives in ../core/refresh-competitor-summary
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const refreshCompetitorSummaryJob = task({
  id: "refresh-competitor-summary",
  queue: summaryQueue,
  maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  run: asTriggerRun(runRefreshCompetitorSummary),
});
