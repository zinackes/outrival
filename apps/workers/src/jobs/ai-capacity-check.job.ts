import { schedules } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runAiCapacityCheck } from "../core/ai-capacity-check";

// Thin Trigger.dev wrapper — the job body lives in ../core/ai-capacity-check
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const aiCapacityCheckJob = schedules.task({
  id: "ai-capacity-check",
  cron: "*/30 * * * *",
  maxDuration: 60,
  run: asTriggerRun(runAiCapacityCheck),
});
