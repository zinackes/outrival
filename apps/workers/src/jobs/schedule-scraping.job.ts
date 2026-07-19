import { schedules } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runScheduleScraping } from "../core/schedule-scraping";

// Thin Trigger.dev wrapper — the job body lives in ../core/schedule-scraping
// (runtime neutral, shared with the pg-boss handler). Deleted at the cutover.
export const scheduleScrapingJob = schedules.task({
  id: "schedule-scraping",
  cron: "0 * * * *",
  maxDuration: 120,
  run: asTriggerRun(runScheduleScraping),
});
