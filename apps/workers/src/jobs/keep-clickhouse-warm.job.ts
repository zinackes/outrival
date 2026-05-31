import { schedules, logger } from "@trigger.dev/sdk/v3";
import { pingClickhouse } from "../lib/clickhouse";

// ClickHouse Cloud (dev/free tier) scales idle compute to zero after a few
// minutes of inactivity. The first competitor-tab read (pricing/hiring/reviews)
// then waits ~30s for the wake-up. A cheap SELECT 1 every 5 min keeps the
// service warm so those reads stay fast. Best-effort — pingClickhouse never
// throws, so a transient failure won't trigger retries.
export const keepClickhouseWarmJob = schedules.task({
  id: "keep-clickhouse-warm",
  cron: "*/5 * * * *",
  maxDuration: 60,

  async run() {
    logger.log("Starting keep-clickhouse-warm");
    const ok = await pingClickhouse();
    logger.log("Completed keep-clickhouse-warm", { ok });
    return { ok };
  },
});
