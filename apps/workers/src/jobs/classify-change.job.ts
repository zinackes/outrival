import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { groqQueue } from "../lib/queues";
import { runClassifyChange } from "../core/classify-change";
import type { Classification } from "@outrival/ai";

// Thin Trigger.dev wrapper — the job body lives in ../core/classify-change (runtime
// neutral, shared with the pg-boss handler). Deleted at the Trigger cutover (Phase 7).
export const classifyChangeJob = task({
  id: "classify-change",
  queue: groqQueue,
  maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  run: asTriggerRun(runClassifyChange),
});

export type { Classification };
