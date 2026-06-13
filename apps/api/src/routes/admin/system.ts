import { Hono } from "hono";
import { runs, queues, schedules } from "@trigger.dev/sdk/v3";
import { sql } from "drizzle-orm";
import { Resend } from "resend";
import { db } from "@outrival/db";
import { logger, getRedis } from "@outrival/shared";
import { checkGlobalBreaker } from "@outrival/ai";
import { getStripe } from "../../lib/stripe";
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

// --- B3: external dependency health ---
type DepStatus = "ok" | "degraded" | "down" | "skipped";
type DepResult = { name: string; status: DepStatus; latencyMs: number | null; detail: string | null };

const DEP_TIMEOUT_MS = 3000;
// Dependency probes hit Stripe/Neon/Upstash/R2/Resend on every load, so cache
// the result briefly — admin refreshes shouldn't hammer external APIs (Stripe
// rate limits) or slow the page on each open.
const DEP_CACHE_MS = 30_000;
let depCache: { at: number; payload: { checkedAt: string; dependencies: DepResult[] } } | null = null;

// Runs a probe with a hard timeout; the probe's own rejection is caught inline
// so a slow brick that errors after we've given up never becomes an unhandled
// rejection. `configured: false` → "skipped" (env not set in this environment).
async function timedCheck(
  name: string,
  configured: boolean,
  run: () => Promise<unknown>,
): Promise<DepResult> {
  if (!configured) return { name, status: "skipped", latencyMs: null, detail: "not configured" };
  const start = Date.now();
  const status = await Promise.race<DepStatus>([
    run().then(
      () => "ok" as const,
      () => "down" as const,
    ),
    new Promise<DepStatus>((res) => setTimeout(() => res("down"), DEP_TIMEOUT_MS)),
  ]);
  return { name, status, latencyMs: Date.now() - start, detail: null };
}

systemRouter.get("/dependencies", async (c) => {
  if (depCache && Date.now() - depCache.at < DEP_CACHE_MS) {
    return c.json({ ...depCache.payload, cached: true });
  }

  const redisClient = getRedis();
  const r2Account = process.env.R2_ACCOUNT_ID;
  const resendKey = process.env.RESEND_API_KEY;

  // AI is degraded-aware (global circuit breaker, patch-22), not just up/down.
  const aiCheck = (async (): Promise<DepResult> => {
    const start = Date.now();
    try {
      const breaker = await checkGlobalBreaker();
      return {
        name: "ai",
        status: breaker.open ? "degraded" : "ok",
        latencyMs: Date.now() - start,
        detail: breaker.open ? (breaker.reason ?? "circuit breaker open") : null,
      };
    } catch {
      return { name: "ai", status: "down", latencyMs: Date.now() - start, detail: null };
    }
  })();

  const dependencies = await Promise.all([
    timedCheck("neon", !!process.env.DATABASE_URL, () => db.execute(sql`SELECT 1`)),
    timedCheck("upstash", !!redisClient, () => redisClient!.ping()),
    // The API has no R2/S3 client — probe endpoint reachability instead (any HTTP
    // response, even 400/403, means TLS + endpoint are up; only a network error
    // is "down"). Avoids pulling @aws-sdk into the API for a health check.
    timedCheck("r2", !!r2Account, () =>
      fetch(`https://${r2Account}.r2.cloudflarestorage.com`, {
        method: "HEAD",
        signal: AbortSignal.timeout(DEP_TIMEOUT_MS),
      }),
    ),
    timedCheck("stripe", !!process.env.STRIPE_SECRET_KEY, () => getStripe().balance.retrieve()),
    timedCheck("resend", !!resendKey, async () => {
      const res = await new Resend(resendKey).domains.list();
      if (res.error) throw new Error(res.error.message);
    }),
    aiCheck,
  ]);

  const payload = { checkedAt: new Date().toISOString(), dependencies };
  depCache = { at: Date.now(), payload };
  return c.json({ ...payload, cached: false });
});
