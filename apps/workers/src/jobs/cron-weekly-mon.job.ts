import { schedules, logger } from "@trigger.dev/sdk/v3";
import { detectStructuralChangesJob } from "./detect-structural-changes.job";
import { analyzeSectoralJob } from "./analyze-sectoral.job";
import { feedbackPatternDetectionJob } from "./feedback-pattern-detection.job";

// Cron-cap consolidation: Trigger's free plan allows only 10 declarative
// schedules. This dispatcher owns one cron slot and fans out to sibling jobs
// that share its cadence, so each still runs without spending its own slot.
export const cronWeeklyMonJob = schedules.task({
  id: "cron-weekly-mon",
  cron: "0 6 * * 1",
  maxDuration: 60,
  async run() {
    logger.log("cron-weekly-mon dispatch");
    const results = await Promise.allSettled([
      detectStructuralChangesJob.trigger(undefined),
      analyzeSectoralJob.trigger(undefined),
      feedbackPatternDetectionJob.trigger(undefined),
    ]);
    const failed = results.filter((r) => r.status === "rejected").length;
    logger.log("cron-weekly-mon dispatched", { total: results.length, failed });
  },
});
