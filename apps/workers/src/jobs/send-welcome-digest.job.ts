import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runSendWelcomeDigest } from "../core/send-welcome-digest";

// Thin Trigger.dev wrapper — the job body lives in ../core/send-welcome-digest
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const sendWelcomeDigestJob = task({
  id: "send-welcome-digest",
  maxDuration: 60,
  retry: { maxAttempts: 1 },
  run: asTriggerRun(runSendWelcomeDigest),
});
