import { schedules, logger, tasks } from "@trigger.dev/sdk/v3";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { db, monitors } from "@outrival/db";

export const scheduleScrapingJob = schedules.task({
  id: "schedule-scraping",
  cron: "0 * * * *",
  maxDuration: 120,

  async run() {
    const now = new Date();
    logger.log("Starting schedule-scraping", { now: now.toISOString() });

    const due = await db.query.monitors.findMany({
      where: and(
        eq(monitors.isActive, true),
        or(isNull(monitors.nextRunAt), lte(monitors.nextRunAt, now)),
      ),
    });

    logger.log("Monitors due", { count: due.length });

    if (due.length === 0) {
      logger.log("Completed schedule-scraping", { enqueued: 0 });
      return { enqueued: 0, total: 0 };
    }

    // One batch call instead of N sequential triggers. Actual execution is
    // throttled by the scrape-monitor queue (concurrencyLimit).
    await tasks.batchTrigger(
      "scrape-monitor",
      due.map((monitor) => ({ payload: { monitorId: monitor.id } })),
    );

    logger.log("Completed schedule-scraping", { enqueued: due.length });
    return { enqueued: due.length, total: due.length };
  },
});
