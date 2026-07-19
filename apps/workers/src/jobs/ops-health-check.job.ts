import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runOpsHealthCheck } from "../core/ops-health-check";

// Thin Trigger.dev wrapper — the job body lives in ../core/ops-health-check
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const opsHealthCheckJob = task({
  id: "ops-health-check",
  maxDuration: 120,
  run: asTriggerRun(runOpsHealthCheck),
});
