import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { backfillQueue } from "../lib/queues";
import { runBackfillHistory } from "../core/backfill-history";

// Thin Trigger.dev wrapper — the job body lives in ../core/backfill-history (runtime
// neutral, shared with the pg-boss handler). Deleted at the Trigger cutover (Phase 7).
export const backfillHistoryJob = task({
  id: "backfill-history",
  queue: backfillQueue,
  maxDuration: 300,
  // Not idempotent (each run inserts archive snapshots): never auto-retry, or a
  // transient failure mid-run would double-seed. Best-effort by design.
  retry: { maxAttempts: 1 },
  run: asTriggerRun(runBackfillHistory),
});
