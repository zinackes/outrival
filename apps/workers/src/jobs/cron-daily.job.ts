import { schedules, logger } from "@trigger.dev/sdk/v3";
import { schedulePlatformDetectionJob } from "./schedule-platform-detection.job";
import { purgeRetentionJob } from "./purge-retention.job";
import { scheduleTechStackJob } from "./schedule-tech-stack.job";
import { detectSilentMonitorsJob } from "./detect-silent-monitors.job";
import { scheduleAiVisibilityJob } from "./schedule-ai-visibility.job";

// Cron-cap consolidation: Trigger's free plan allows only 10 declarative
// schedules. This dispatcher owns one cron slot and fans out to sibling jobs
// that share its cadence, so each still runs without spending its own slot.
export const cronDailyJob = schedules.task({
  id: "cron-daily",
  cron: "0 4 * * *",
  maxDuration: 60,
  async run() {
    logger.log("cron-daily dispatch");
    const results = await Promise.allSettled([
      schedulePlatformDetectionJob.trigger(undefined),
      purgeRetentionJob.trigger(undefined),
      scheduleTechStackJob.trigger(undefined),
      detectSilentMonitorsJob.trigger(undefined),
      scheduleAiVisibilityJob.trigger(undefined),
    ]);
    const failed = results.filter((r) => r.status === "rejected").length;
    logger.log("cron-daily dispatched", { total: results.length, failed });
  },
});
