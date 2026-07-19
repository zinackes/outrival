import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runDetectPlatform } from "../core/detect-platform";

// Thin Trigger.dev wrapper — the job body lives in ../core/detect-platform
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const detectPlatformJob = task({
  id: "detect-platform",
  machine: "medium-1x",
  maxDuration: 120,
  retry: { maxAttempts: 2 },
  run: asTriggerRun(runDetectPlatform),
});
