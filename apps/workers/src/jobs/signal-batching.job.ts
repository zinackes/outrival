import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runSignalBatching } from "../core/signal-batching";

// Thin Trigger.dev wrapper — the job body lives in ../core/signal-batching
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const signalBatchingJob = task({
  id: "signal-batching",
  maxDuration: 300,
  retry: { maxAttempts: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000, factor: 2 },
  run: asTriggerRun(runSignalBatching),
});
