import { schedules, logger } from "@trigger.dev/sdk/v3";
import { relevanceThresholdRecalculationJob } from "./relevance-threshold-recalculation.job";
import { detectNewCompetitorsJob } from "./detect-new-competitors.job";

// Cron-cap consolidation: Trigger's free plan allows only 10 declarative
// schedules. This dispatcher owns one cron slot and fans out to sibling jobs
// that share its cadence, so each still runs without spending its own slot.
export const cronWeeklySunJob = schedules.task({
  id: "cron-weekly-sun",
  cron: "0 3 * * 0",
  maxDuration: 60,
  async run() {
    logger.log("cron-weekly-sun dispatch");
    const results = await Promise.allSettled([
      relevanceThresholdRecalculationJob.trigger(undefined),
      detectNewCompetitorsJob.trigger(undefined),
    ]);
    const failed = results.filter((r) => r.status === "rejected").length;
    logger.log("cron-weekly-sun dispatched", { total: results.length, failed });
  },
});
