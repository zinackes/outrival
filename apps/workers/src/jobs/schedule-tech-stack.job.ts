import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runScheduleTechStack } from "../core/schedule-tech-stack";

// Thin Trigger.dev wrapper — the job body lives in ../core/schedule-tech-stack
// (runtime neutral, shared with the pg-boss handler). Deleted at the cutover.
export const scheduleTechStackJob = task({
  id: "schedule-tech-stack",
  maxDuration: 120,
  run: asTriggerRun(runScheduleTechStack),
});
