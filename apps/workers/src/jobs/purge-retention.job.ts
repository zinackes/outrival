import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runPurgeRetention } from "../core/purge-retention";

// Thin Trigger.dev wrapper — the job body lives in ../core/purge-retention
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const purgeRetentionJob = task({
  id: "purge-retention",
  maxDuration: 600,
  retry: { maxAttempts: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000, factor: 2 },
  run: asTriggerRun(runPurgeRetention),
});
