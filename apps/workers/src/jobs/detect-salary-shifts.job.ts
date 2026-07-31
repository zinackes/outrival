import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runDetectSalaryShifts } from "../core/detect-salary-shifts";

// Thin Trigger.dev wrapper — the job body lives in ../core/detect-salary-shifts
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const detectSalaryShiftsJob = task({
  id: "detect-salary-shifts",
  maxDuration: 60,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  run: asTriggerRun(runDetectSalaryShifts),
});
