import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runDetectSilentMonitors } from "../core/detect-silent-monitors";

// Thin Trigger.dev wrapper — the job body lives in ../core/detect-silent-monitors
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const detectSilentMonitorsJob = task({
  id: "detect-silent-monitors",
  maxDuration: 300,
  run: asTriggerRun(runDetectSilentMonitors),
});
