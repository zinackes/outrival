import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runIngestContentItems } from "../core/ingest-content-items";

// Thin Trigger.dev wrapper — the job body lives in ../core/ingest-content-items
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const ingestContentItemsJob = task({
  id: "ingest-content-items",
  maxDuration: 300,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  run: asTriggerRun(runIngestContentItems),
});
