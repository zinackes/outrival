import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runSendAlert } from "../core/send-alert";

// Thin Trigger.dev wrapper — the job body lives in ../core/send-alert (runtime
// neutral, shared with the pg-boss handler). Deleted at the Trigger cutover (Phase 7).
export const sendAlertJob = task({
  id: "send-alert",
  maxDuration: 60,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  run: asTriggerRun(runSendAlert),
});
