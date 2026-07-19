import { schedules } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runGenerateDailyDigest } from "../core/generate-daily-digest";

// Thin Trigger.dev wrapper — the job body lives in ../core/generate-daily-digest
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const generateDailyDigestJob = schedules.task({
  id: "generate-daily-digest",
  cron: "0 * * * *",
  maxDuration: 300,
  retry: { maxAttempts: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000, factor: 2 },
  run: asTriggerRun(runGenerateDailyDigest),
});
