import { Hono } from "hono";
import { z } from "zod";
import { sql } from "drizzle-orm";
import {
  listFlaggedQualityChecks,
  resolveQualityCheck,
  getQualityReviewStats,
  getQualityByTask,
  getConfidenceDistribution,
} from "@outrival/db";
import { redis } from "@outrival/shared";
import { loadProviders, checkGlobalBreaker } from "@outrival/ai";
import { analyticsQuery } from "../../lib/analytics-safe";
import { logAudit, num, rate, type AdminVariables } from "./shared";

export const aiRouter = new Hono<{ Variables: AdminVariables }>();

// --- AI health: per-task parse_failed/error rates (7d) + signals/day (7d) ---
aiRouter.get("/ai-health", async (c) => {
  const byTask = await analyticsQuery<{
    task: string;
    total: string;
    parse_failed: string;
    errors: string;
  }>(sql`
    SELECT task,
           count(*) AS total,
           count(*) filter (where status = 'parse_failed') AS parse_failed,
           count(*) filter (where status = 'error') AS errors
    FROM ai_runs
    WHERE recorded_at >= now() - make_interval(days => 7)
    GROUP BY task
    ORDER BY total DESC
  `);

  const tasksHealth = byTask.map((r) => {
    const total = num(r.total);
    return {
      task: r.task,
      total,
      parseFailed: num(r.parse_failed),
      parseFailedRate: rate(num(r.parse_failed), total),
      errors: num(r.errors),
      errorRate: rate(num(r.errors), total),
    };
  });

  const signalsByDay = await analyticsQuery<{ day: string; count: string }>(sql`
    SELECT to_char(recorded_at, 'YYYY-MM-DD') AS day, count(*) AS count
    FROM signal_feed
    WHERE recorded_at >= now() - make_interval(days => 7)
    GROUP BY day
    ORDER BY day
  `);

  // Provider pool health (patch-22): per-provider token quota used today + breaker
  // state from Redis, plus the global breaker and a saturation forecast. Redis is the
  // safe facade — values read 0 / null when Upstash is unset, so this never throws.
  const today = new Date().toISOString().slice(0, 10);
  const providerDefs = loadProviders();
  const providers = await Promise.all(
    providerDefs.map(async (p) => {
      const [usedRaw, breaker] = await Promise.all([
        redis.get(`ai:usage:${p.id}:${today}`),
        redis.get(`ai:breaker:${p.id}`),
      ]);
      const usedTokens = Number(usedRaw ?? 0);
      return {
        id: p.id,
        tier: p.tier,
        priority: p.priority,
        dailyTokenQuota: p.dailyTokenQuota,
        usedTokens,
        pct: p.dailyTokenQuota > 0 ? usedTokens / p.dailyTokenQuota : 0,
        breaker: breaker ? String(breaker) : null,
      };
    }),
  );

  const globalBreaker = await checkGlobalBreaker();

  const totalUsed = providers.reduce((a, p) => a + p.usedTokens, 0);
  const totalCapacity = providers.reduce((a, p) => a + p.dailyTokenQuota, 0);
  const now = new Date();
  const msSinceMidnight =
    Date.now() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const hoursElapsed = Math.max(0.1, msSinceMidnight / 3_600_000);
  const ratePerHour = totalUsed / hoursElapsed;
  const remaining = Math.max(0, totalCapacity * 0.95 - totalUsed);
  const hoursToSaturation = ratePerHour > 0 ? remaining / ratePerHour : null;

  return c.json({
    window: "7d",
    tasks: tasksHealth,
    signalsByDay: signalsByDay.map((r) => ({ day: r.day, count: num(r.count) })),
    providers,
    globalBreaker: {
      open: globalBreaker.open,
      reason: globalBreaker.reason ?? null,
      resetInSec: globalBreaker.resetInSec ?? null,
    },
    prediction: {
      usagePct: totalCapacity > 0 ? totalUsed / totalCapacity : 0,
      totalUsed,
      totalCapacity,
      hoursToSaturation,
    },
  });
});

// --- AI review queue + quality metrics (patch-24) ---

// Flagged outputs awaiting a human verdict, plus the 30-day header stats.
aiRouter.get("/ai-review-queue", async (c) => {
  const [items, stats] = await Promise.all([
    listFlaggedQualityChecks(100),
    getQualityReviewStats(30),
  ]);
  return c.json({ items, stats });
});

const ResolveSchema = z.object({
  resolution: z.enum(["correct", "hallucination_confirmed", "false_positive"]),
});

aiRouter.post("/ai-review/:id/resolve", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = ResolveSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_resolution" }, 400);

  const user = c.get("user");
  await resolveQualityCheck(id, parsed.data.resolution, user.id);
  await logAudit(user.email, "resolve_ai_review", "ai_quality_check", id, {
    resolution: parsed.data.resolution,
  });
  return c.json({ ok: true });
});

// Aggregated AI quality metrics for the ops dashboard (patch-24, step 9).
aiRouter.get("/ai-quality-metrics", async (c) => {
  const [stats, byTask, confidence] = await Promise.all([
    getQualityReviewStats(30),
    getQualityByTask(30),
    getConfidenceDistribution(30),
  ]);
  return c.json({ windowDays: 30, stats, byTask, confidence });
});
