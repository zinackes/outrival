import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runDetectReviewThemeShifts } from "../core/detect-review-theme-shifts";

// Thin Trigger.dev wrapper — the job body lives in
// ../core/detect-review-theme-shifts (runtime neutral, shared with the pg-boss
// handler). Deleted at the Trigger cutover (Phase 7).
export const detectReviewThemeShiftsJob = task({
  id: "detect-review-theme-shifts",
  maxDuration: 60,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  run: asTriggerRun(runDetectReviewThemeShifts),
});
