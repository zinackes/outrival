import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runGenerateBattleCard } from "../core/generate-battle-card";

// Thin Trigger.dev wrapper — the job body lives in ../core/generate-battle-card
// (runtime neutral, shared with the pg-boss handler). Deleted at the cutover.
export const generateBattleCardJob = task({
  id: "generate-battle-card",
  // Launches Chromium to render the PDF — too tight on the default 0.5 GB.
  machine: "small-2x",
  maxDuration: 180,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  run: asTriggerRun(runGenerateBattleCard),
});
