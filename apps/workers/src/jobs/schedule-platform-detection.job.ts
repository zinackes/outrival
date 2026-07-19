import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runSchedulePlatformDetection } from "../core/schedule-platform-detection";

// Thin Trigger.dev wrapper — the job body lives in
// ../core/schedule-platform-detection (runtime neutral, shared with the pg-boss
// handler). Deleted at the cutover.
export const schedulePlatformDetectionJob = task({
  id: "schedule-platform-detection",
  maxDuration: 120,
  run: asTriggerRun(runSchedulePlatformDetection),
});
