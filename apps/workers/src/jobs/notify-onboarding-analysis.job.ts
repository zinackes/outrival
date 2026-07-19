import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runNotifyOnboardingAnalysis } from "../core/notify-onboarding-analysis";

// Thin Trigger.dev wrapper — the job body lives in ../core/notify-onboarding-analysis
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger cutover
// (Phase 7).
export const notifyOnboardingAnalysisJob = task({
  id: "notify-onboarding-analysis",
  maxDuration: 600,
  run: asTriggerRun(runNotifyOnboardingAnalysis),
});
