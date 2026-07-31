import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runDetectHiringFootprint } from "../core/detect-hiring-footprint";

// Thin Trigger.dev wrapper — the job body lives in ../core/detect-hiring-footprint
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const detectHiringFootprintJob = task({
  id: "detect-hiring-footprint",
  maxDuration: 60,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  run: asTriggerRun(runDetectHiringFootprint),
});
