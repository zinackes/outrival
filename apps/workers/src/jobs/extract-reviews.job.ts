import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runExtractReviews } from "../core/extract-reviews";

// Thin Trigger.dev wrapper — the job body lives in ../core/extract-reviews (runtime
// neutral, shared with the pg-boss handler). Deleted at the Trigger cutover (Phase 7).
export const extractReviewsJob = task({
  id: "extract-reviews",
  maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  run: asTriggerRun(runExtractReviews),
});
