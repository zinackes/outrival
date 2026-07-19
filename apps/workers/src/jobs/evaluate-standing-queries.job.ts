import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { groqQueue } from "../lib/queues";
import { runEvaluateStandingQueries } from "../core/evaluate-standing-queries";

// Thin Trigger.dev wrapper — the job body lives in ../core/evaluate-standing-queries
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger cutover
// (Phase 7).
export const evaluateStandingQueriesJob = task({
  id: "evaluate-standing-queries",
  // The judge shares the free-tier AI lane; the internal ask run also lands on the
  // pool. Serializing keeps classify→signal from being starved.
  queue: groqQueue,
  maxDuration: 300,
  retry: { maxAttempts: 3, minTimeoutInMs: 2000, maxTimeoutInMs: 30000, factor: 2 },
  run: asTriggerRun(runEvaluateStandingQueries),
});
