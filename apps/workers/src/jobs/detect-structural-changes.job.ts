import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runDetectStructuralChanges } from "../core/detect-structural-changes";

// Thin Trigger.dev wrapper — the job body lives in ../core/detect-structural-changes
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const detectStructuralChangesJob = task({
  id: "detect-structural-changes",
  maxDuration: 600,
  run: asTriggerRun(runDetectStructuralChanges),
});
