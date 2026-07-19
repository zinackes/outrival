import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runSendMonthlyRecap } from "../core/send-monthly-recap";

// Thin Trigger.dev wrapper — the job body lives in ../core/send-monthly-recap
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const sendMonthlyRecapJob = task({
  id: "send-monthly-recap",
  maxDuration: 60,
  retry: { maxAttempts: 1 },
  run: asTriggerRun(runSendMonthlyRecap),
});
