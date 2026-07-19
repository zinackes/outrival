import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runDetectNewCompetitors } from "../core/detect-new-competitors";

// Thin Trigger.dev wrapper — the job body lives in ../core/detect-new-competitors
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const detectNewCompetitorsJob = task({
  id: "detect-new-competitors",
  maxDuration: 600,
  run: asTriggerRun(runDetectNewCompetitors),
});
