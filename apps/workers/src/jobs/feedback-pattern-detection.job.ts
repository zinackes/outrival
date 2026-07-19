import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runFeedbackPatternDetection } from "../core/feedback-pattern-detection";

// Thin Trigger.dev wrapper — the job body lives in ../core/feedback-pattern-detection
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const feedbackPatternDetectionJob = task({
  id: "feedback-pattern-detection",
  maxDuration: 120,
  run: asTriggerRun(runFeedbackPatternDetection),
});
