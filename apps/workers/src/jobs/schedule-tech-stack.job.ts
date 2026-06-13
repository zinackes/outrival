import { schedules, logger, tasks } from "@trigger.dev/sdk/v3";
import { and, isNull, isNotNull, lte, ne, or } from "drizzle-orm";
import { db, competitors } from "@outrival/db";
import { TECH_STACK_SCRAPE_INTERVAL_DAYS } from "@outrival/shared";

// Independent monthly tech-stack scheduler (patch-18). Runs daily but only
// enqueues competitors whose tech stack is due (never scraped, or older than
// TECH_STACK_SCRAPE_INTERVAL_DAYS) — the per-competitor cadence lives on
// competitors.techStackScrapedAt, NOT on a monitor row, so this never touches the
// homepage scrape-monitor pipeline. Self-product (type="self") is excluded.
export const scheduleTechStackJob = schedules.task({
  id: "schedule-tech-stack",
  cron: "0 6 * * *",
  maxDuration: 120,

  async run() {
    const intervalDays = Number(
      process.env.TECH_STACK_SCRAPE_INTERVAL_DAYS ?? TECH_STACK_SCRAPE_INTERVAL_DAYS,
    );
    const cutoff = new Date(Date.now() - intervalDays * 24 * 60 * 60 * 1000);
    logger.log("Starting schedule-tech-stack", {
      intervalDays,
      cutoff: cutoff.toISOString(),
    });

    const due = await db.query.competitors.findMany({
      where: and(
        isNotNull(competitors.url),
        isNull(competitors.deletedAt),
        ne(competitors.type, "self"),
        or(
          isNull(competitors.techStackScrapedAt),
          lte(competitors.techStackScrapedAt, cutoff),
        ),
      ),
      columns: { id: true },
    });

    if (due.length === 0) {
      logger.log("Completed schedule-tech-stack", { enqueued: 0 });
      return { enqueued: 0 };
    }

    await tasks.batchTrigger(
      "scrape-tech-stack",
      due.map((c) => ({ payload: { competitorId: c.id } })),
    );

    logger.log("Completed schedule-tech-stack", { enqueued: due.length });
    return { enqueued: due.length };
  },
});
