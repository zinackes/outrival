import { schedules, logger, tasks } from "@trigger.dev/sdk/v3";
import { and, isNull, isNotNull, lte, ne, or } from "drizzle-orm";
import { db, competitors } from "@outrival/db";

// Periodic platform re-detection (patch-31), mirroring schedule-tech-stack. Runs
// daily but only enqueues competitors that are due — never detected, or older than
// PLATFORM_REDETECT_INTERVAL_DAYS — keyed on competitors.platformDetectedAt (a
// dedicated cadence column, like techStackScrapedAt). Self-product (type="self")
// is excluded. The connector-failure trigger (patch-31 phase 5) is separate.
export const schedulePlatformDetectionJob = schedules.task({
  id: "schedule-platform-detection",
  cron: "0 4 * * *",
  maxDuration: 120,

  async run() {
    if (process.env.PLATFORM_DETECTION_ENABLED === "false") {
      logger.log("Platform detection disabled, skipping");
      return { enqueued: 0 };
    }

    const intervalDays = Number(process.env.PLATFORM_REDETECT_INTERVAL_DAYS ?? 30);
    const cutoff = new Date(Date.now() - intervalDays * 24 * 60 * 60 * 1000);
    logger.log("Starting schedule-platform-detection", {
      intervalDays,
      cutoff: cutoff.toISOString(),
    });

    const due = await db.query.competitors.findMany({
      where: and(
        isNotNull(competitors.url),
        isNull(competitors.deletedAt),
        ne(competitors.type, "self"),
        or(
          isNull(competitors.platformDetectedAt),
          lte(competitors.platformDetectedAt, cutoff),
        ),
      ),
      columns: { id: true },
    });

    if (due.length === 0) {
      logger.log("Completed schedule-platform-detection", { enqueued: 0 });
      return { enqueued: 0 };
    }

    await tasks.batchTrigger(
      "detect-platform",
      due.map((c) => ({ payload: { competitorId: c.id } })),
    );

    logger.log("Completed schedule-platform-detection", { enqueued: due.length });
    return { enqueued: due.length };
  },
});
