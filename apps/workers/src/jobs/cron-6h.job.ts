import { schedules, logger } from "@trigger.dev/sdk/v3";
import { signalBatchingJob } from "./signal-batching.job";
import { opsHealthCheckJob } from "./ops-health-check.job";

// Cron-cap consolidation: Trigger's free plan allows only 10 declarative
// schedules. This dispatcher owns one cron slot and fans out to sibling jobs
// that share its cadence, so each still runs without spending its own slot.
export const cron6hJob = schedules.task({
  id: "cron-6h",
  cron: "0 */6 * * *",
  maxDuration: 60,
  async run() {
    logger.log("cron-6h dispatch");
    const results = await Promise.allSettled([
      signalBatchingJob.trigger(undefined),
      opsHealthCheckJob.trigger(undefined),
    ]);
    const failed = results.filter((r) => r.status === "rejected").length;
    logger.log("cron-6h dispatched", { total: results.length, failed });
  },
});
