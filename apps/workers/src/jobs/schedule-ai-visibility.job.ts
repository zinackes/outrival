import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runScheduleAiVisibility } from "../core/schedule-ai-visibility";

// Thin Trigger.dev wrapper — the job body lives in ../core/schedule-ai-visibility
// (runtime neutral, shared with the pg-boss handler). Deleted at the cutover.
export const scheduleAiVisibilityJob = task({
  id: "schedule-ai-visibility",
  maxDuration: 120,
  run: asTriggerRun(runScheduleAiVisibility),
});
