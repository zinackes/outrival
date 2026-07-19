import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runAiVisibilityTeaser, onAiVisibilityTeaserFailure } from "../core/ai-visibility-teaser";

// Thin Trigger.dev wrapper — the job body lives in ../core/ai-visibility-teaser
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const aiVisibilityTeaserJob = task({
  id: "ai-visibility-teaser",
  maxDuration: 120,
  // Best-effort, not idempotent past the terminal row it writes: never auto-retry
  // (a retry would re-spend free-tier quota and could double-run).
  retry: { maxAttempts: 1 },
  run: asTriggerRun(runAiVisibilityTeaser),
  onFailure: onAiVisibilityTeaserFailure,
});
