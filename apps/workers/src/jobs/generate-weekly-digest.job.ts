import { schedules } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runGenerateWeeklyDigest } from "../core/generate-weekly-digest";

// Thin Trigger.dev wrapper — the job body lives in ../core/generate-weekly-digest
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const generateWeeklyDigestJob = schedules.task({
  id: "generate-weekly-digest",
  cron: "0 8 * * 1",
  maxDuration: 600,
  // When the AI circuit breaker is open at cron time (patch-22), the job throws and
  // retries on a backoff that spreads over ~the next hour instead of burning the
  // week's single run against dead providers. Idempotent per (org, weekStart), so a
  // retry only re-processes orgs whose digest wasn't sent yet.
  retry: { maxAttempts: 4, minTimeoutInMs: 60_000, maxTimeoutInMs: 1_800_000, factor: 6 },
  run: asTriggerRun(runGenerateWeeklyDigest),
});
