import { Hono } from "hono";
import { runs, queues, schedules } from "@trigger.dev/sdk/v3";
import { logger } from "@outrival/shared";
import type { AdminVariables } from "./shared";

export const systemRouter = new Hono<{ Variables: AdminVariables }>();

// Run statuses that count as a failure for the 24h failure panel.
const FAILED_STATUSES = ["FAILED", "CRASHED", "SYSTEM_FAILURE", "TIMED_OUT"];
// We don't paginate the failure/throughput lists — a single capped page is
// enough to spot a backlog or a spike without hammering the management API.
const FAILED_CAP = 50;
const DURATION_SAMPLE = 50;

// B2 (patch admin-v2) — Trigger.dev queue + cron health. This is the AGGREGATE
// view that /admin/jobs (raw, filterable run list) doesn't give: per-queue
// backlog & concurrency saturation, the 24h failure count, recent throughput,
// and schedule freshness (next run / paused crons). The real capacity signal
// lives here, not in VPS RAM — scraping runs on Trigger.dev Cloud machines.
//
// Every Trigger.dev call is guarded INDEPENDENTLY: a missing TRIGGER_SECRET_KEY
// or an API blip degrades that section to `available: false`, never a 500. The
// project secret key (already set for triggering) is enough to read the
// management API — no separate personal access token needed.
systemRouter.get("/queue-health", async (c) => {
  const configured = !!process.env.TRIGGER_SECRET_KEY;

  // --- Queues: backlog (queued) + executing (running) + concurrency cap ---
  let queueRows: {
    name: string;
    type: string;
    queued: number;
    running: number;
    paused: boolean;
    concurrencyLimit: number | null;
  }[] = [];
  let queuesAvailable = false;
  if (configured) {
    try {
      const page = await queues.list({ perPage: 100 });
      queueRows = page.data
        .map((q) => ({
          name: q.name,
          type: q.type,
          queued: q.queued,
          running: q.running,
          paused: q.paused,
          concurrencyLimit: q.concurrencyLimit,
        }))
        .sort((a, b) => b.queued - a.queued || b.running - a.running);
      queuesAvailable = true;
    } catch (err) {
      logger.error({ err }, "trigger queues.list failed");
    }
  }
  const totalQueued = queueRows.reduce((n, q) => n + q.queued, 0);
  const totalRunning = queueRows.reduce((n, q) => n + q.running, 0);
  const pausedCount = queueRows.filter((q) => q.paused).length;

  // --- Failures (24h): recent failed/crashed runs, capped at one page ---
  let failedRows: { id: string; taskIdentifier: string; status: string; createdAt: Date }[] = [];
  let failuresAvailable = false;
  if (configured) {
    try {
      const page = await runs.list({
        status: FAILED_STATUSES,
        period: "24h",
        limit: FAILED_CAP,
      } as Parameters<typeof runs.list>[0]);
      failedRows = page.data.map((r) => ({
        id: r.id,
        taskIdentifier: r.taskIdentifier,
        status: r.status,
        createdAt: r.createdAt,
      }));
      failuresAvailable = true;
    } catch (err) {
      logger.error({ err }, "trigger runs.list (failures) failed");
    }
  }

  // --- Throughput (24h): avg duration over a sample of completed runs ---
  let avgDurationMs: number | null = null;
  let durationSampled = 0;
  let throughputAvailable = false;
  if (configured) {
    try {
      const page = await runs.list({
        status: ["COMPLETED"],
        period: "24h",
        limit: DURATION_SAMPLE,
      } as Parameters<typeof runs.list>[0]);
      const durations = page.data.map((r) => r.durationMs ?? 0).filter((d) => d > 0);
      durationSampled = durations.length;
      avgDurationMs = durations.length
        ? Math.round(durations.reduce((n, d) => n + d, 0) / durations.length)
        : null;
      throughputAvailable = true;
    } catch (err) {
      logger.error({ err }, "trigger runs.list (throughput) failed");
    }
  }

  // --- Schedules: registered crons + next run + paused/overdue flags ---
  const now = Date.now();
  let scheduleRows: {
    id: string;
    task: string;
    cron: string;
    description: string;
    timezone: string;
    nextRun: Date | null;
    active: boolean;
    overdue: boolean;
  }[] = [];
  let schedulesAvailable = false;
  if (configured) {
    try {
      const page = await schedules.list({ perPage: 100 });
      scheduleRows = page.data
        .map((s) => {
          const nextRun = s.nextRun ?? null;
          return {
            id: s.id,
            task: s.task,
            cron: s.generator.expression,
            description: s.generator.description,
            timezone: s.timezone,
            nextRun,
            active: s.active,
            // An active schedule whose nextRun is in the past hasn't been picked
            // up — a silent scheduler stall worth surfacing.
            overdue: s.active && !!nextRun && nextRun.getTime() < now,
          };
        })
        .sort((a, b) => {
          const at = a.nextRun?.getTime() ?? Infinity;
          const bt = b.nextRun?.getTime() ?? Infinity;
          return at - bt;
        });
      schedulesAvailable = true;
    } catch (err) {
      logger.error({ err }, "trigger schedules.list failed");
    }
  }

  return c.json({
    configured,
    queues: {
      available: queuesAvailable,
      totalQueued,
      totalRunning,
      pausedCount,
      rows: queueRows,
    },
    failures24h: {
      available: failuresAvailable,
      count: failedRows.length,
      capped: failedRows.length >= FAILED_CAP,
      rows: failedRows,
    },
    throughput24h: {
      available: throughputAvailable,
      avgDurationMs,
      sampled: durationSampled,
    },
    schedules: {
      available: schedulesAvailable,
      activeCount: scheduleRows.filter((s) => s.active).length,
      overdueCount: scheduleRows.filter((s) => s.overdue).length,
      rows: scheduleRows,
    },
  });
});
