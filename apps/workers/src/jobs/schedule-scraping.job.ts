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

    let enqueued = 0;
    for (const monitor of due) {
      try {
        await tasks.trigger("scrape-monitor", { monitorId: monitor.id });
        enqueued++;
      } catch (err) {
        logger.error("Failed to enqueue scrape-monitor", {
          monitorId: monitor.id,
          err: String(err),
        });
      }
    }

    logger.log("Completed schedule-scraping", { enqueued });
    return { enqueued, total: due.length };
  },
});
