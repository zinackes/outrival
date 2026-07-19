import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runExtractSelfProfile } from "../core/extract-self-profile";

// Thin Trigger.dev wrapper — the job body lives in ../core/extract-self-profile
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const extractSelfProfileJob = task({
  id: "extract-self-profile",
  maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  run: asTriggerRun(runExtractSelfProfile),
});
