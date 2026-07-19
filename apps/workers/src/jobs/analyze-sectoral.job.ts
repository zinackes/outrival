import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runAnalyzeSectoral } from "../core/analyze-sectoral";

// Thin Trigger.dev wrapper — the job body lives in ../core/analyze-sectoral
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const analyzeSectoralJob = task({
  id: "analyze-sectoral",
  maxDuration: 600,
  run: asTriggerRun(runAnalyzeSectoral),
});
