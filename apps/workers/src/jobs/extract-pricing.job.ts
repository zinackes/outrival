import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runExtractPricing } from "../core/extract-pricing";

// Thin Trigger.dev wrapper — the job body lives in ../core/extract-pricing (runtime
// neutral, shared with the pg-boss handler). Deleted at the Trigger cutover (Phase 7).
export const extractPricingJob = task({
  id: "extract-pricing",
  maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  run: asTriggerRun(runExtractPricing),
});
