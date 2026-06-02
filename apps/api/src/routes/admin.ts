import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, ne, gte, ilike, inArray, isNull, isNotNull, or, sql } from "drizzle-orm";
import {
  db,
  organizations,
  users,
  competitors,
  monitors,
  signals,
  feedback,
  qualityFeedback,
  auditLog,
  onboardingSessions,
  monitorAlternatives,
  structuralChanges,
  listFlaggedQualityChecks,
  resolveQualityCheck,
  getQualityReviewStats,
  getQualityByTask,
  getConfidenceDistribution,
} from "@outrival/db";
import { getBytesFromR2, logger, redis } from "@outrival/shared";
import { loadProviders, checkGlobalBreaker } from "@outrival/ai";
import { tasks, runs } from "@trigger.dev/sdk/v3";
import { authMiddleware } from "../middleware/auth";
import { adminMiddleware } from "../middleware/admin";
import { chQuery } from "../lib/clickhouse-safe";

// --- Cost estimation constants. TRENDS, not accounting. Documented in
//     findings.md § Patch-02/20. Tune as real invoices come in. ---
// Patch-20 proxy model: datacenter is a FIXED monthly cost (flat, bandwidth
// unlimited), residential is pay-per-GB. We don't meter GB, so we surface the
// fixed datacenter line plus a rough per-residential-scrape estimate as a trend.
const DATACENTER_FIXED_USD_PER_MONTH = 10;
const USD_PER_RESIDENTIAL_SCRAPE = 0.05; // ~a few hundred KB/page at ~$4.7/GB
// Groq llama-3.x blended per-call estimate (~1.5k in + ~0.5k out, mixed 8b/70b).
const USD_PER_AI_CALL = 0.0012;

// A monitor is "dead" when its most recent N runs are ALL failures.
const DEAD_RUN_THRESHOLD = 3;

type Variables = { user: { id: string; email: string }; session: unknown };

export const adminRouter = new Hono<{ Variables: Variables }>();

// Auth FIRST (sets c.get("user")), THEN the email-allowlist admin gate.
adminRouter.use("*", authMiddleware);
adminRouter.use("*", adminMiddleware);

// Audit trail for sensitive actions. Best-effort: a logging failure must never
// break the admin action itself.
async function logAudit(
  actorEmail: string,
  action: string,
  targetType: string | null,
  targetId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorEmail,
      action,
      targetType,
      targetId,
      metadata: metadata ?? null,
    });
  } catch (err) {
    logger.error({ err, action }, "audit log insert failed");
  }
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function rate(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

// --- Overview: orgs by plan, users, tracked competitors, signals (7d) ---
adminRouter.get("/overview", async (c) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);
  const [orgsByPlan, userCount, competitorCount, signalCount] = await Promise.all([
    db
      .select({ plan: organizations.plan, count: sql<number>`count(*)::int` })
      .from(organizations)
      .groupBy(organizations.plan),
    db.select({ count: sql<number>`count(*)::int` }).from(users),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(competitors)
      .where(and(isNull(competitors.deletedAt), ne(competitors.type, "self"))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(signals)
      .where(gte(signals.createdAt, sevenDaysAgo)),
  ]);

  return c.json({
    orgsByPlan,
    totalUsers: userCount[0]?.count ?? 0,
    totalCompetitors: competitorCount[0]?.count ?? 0,
    signals7d: signalCount[0]?.count ?? 0,
  });
});

// --- Scraping health: per-source reliability/proxy/duration (24h) + dead monitors ---
adminRouter.get("/scraping-health", async (c) => {
  const bySource = await chQuery<{
    source_type: string;
    total: string;
    failed: string;
    proxy: string;
    avg_ms: number;
  }>({
    query: `
      SELECT source_type,
             count() AS total,
             countIf(status = 'failed') AS failed,
             countIf(level >= 2) AS proxy,
             round(avg(duration_ms)) AS avg_ms
      FROM scrape_runs
      WHERE recorded_at >= now() - INTERVAL 24 HOUR
      GROUP BY source_type
      ORDER BY total DESC
    `,
  });

  // Cascade-level distribution (patch-20): what % of scrapes stay free (L0/L1)
  // vs escalate to paid datacenter (L2) / residential (L3) / Camoufox (L4).
  const levelRows = await chQuery<{ level: number; c: string }>({
    query: `
      SELECT level, count() AS c
      FROM scrape_runs
      WHERE recorded_at >= now() - INTERVAL 24 HOUR
      GROUP BY level
    `,
  });
  const levelCount = (l: number) => num(levelRows.find((r) => Number(r.level) === l)?.c ?? "0");
  const levels = {
    l0: levelCount(0),
    l1: levelCount(1),
    l2: levelCount(2),
    l3: levelCount(3),
    l4: levelCount(4),
  };

  const sources = bySource.map((r) => {
    const total = num(r.total);
    return {
      sourceType: r.source_type,
      total,
      failed: num(r.failed),
      failureRate: rate(num(r.failed), total),
      proxyRate: rate(num(r.proxy), total),
      avgMs: num(r.avg_ms),
    };
  });

  // Last few runs per monitor; a monitor whose latest N are all failures is dead.
  const recent = await chQuery<{
    monitor_id: string;
    competitor_id: string;
    source_type: string;
    statuses: string[];
  }>({
    query: `
      SELECT monitor_id,
             any(competitor_id) AS competitor_id,
             any(source_type) AS source_type,
             groupArray(status) AS statuses
      FROM (
        SELECT monitor_id, competitor_id, source_type, status, recorded_at
        FROM scrape_runs
        ORDER BY recorded_at DESC
        LIMIT 5 BY monitor_id
      )
      GROUP BY monitor_id
    `,
  });

  const deadRaw = recent.filter(
    (r) =>
      r.statuses.length >= DEAD_RUN_THRESHOLD &&
      r.statuses.slice(0, DEAD_RUN_THRESHOLD).every((s) => s === "failed"),
  );

  // Enrich the (small) dead set with competitor names from Postgres.
  const compIds = [...new Set(deadRaw.map((d) => d.competitor_id))].filter(Boolean);
  const comps = compIds.length
    ? await db
        .select({ id: competitors.id, name: competitors.name })
        .from(competitors)
        .where(inArray(competitors.id, compIds))
    : [];
  const nameById = new Map(comps.map((x) => [x.id, x.name]));

  const deadMonitors = deadRaw.map((d) => ({
    monitorId: d.monitor_id,
    competitorId: d.competitor_id,
    competitorName: nameById.get(d.competitor_id) ?? null,
    sourceType: d.source_type,
    recentStatuses: d.statuses,
  }));

  return c.json({ window: "24h", sources, levels, deadMonitors });
});

// --- AI health: per-task parse_failed/error rates (7d) + signals/day (7d) ---
adminRouter.get("/ai-health", async (c) => {
  const byTask = await chQuery<{
    task: string;
    total: string;
    parse_failed: string;
    errors: string;
  }>({
    query: `
      SELECT task,
             count() AS total,
             countIf(status = 'parse_failed') AS parse_failed,
             countIf(status = 'error') AS errors
      FROM ai_runs
      WHERE recorded_at >= now() - INTERVAL 7 DAY
      GROUP BY task
      ORDER BY total DESC
    `,
  });

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

  const signalsByDay = await chQuery<{ day: string; count: string }>({
    query: `
      SELECT toDate(recorded_at) AS day, count() AS count
      FROM signal_feed
      WHERE recorded_at >= now() - INTERVAL 7 DAY
      GROUP BY day
      ORDER BY day
    `,
  });

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

// --- Cost: trend estimates (NOT accounting), clearly flagged ---
adminRouter.get("/cost", async (c) => {
  const proxyRows = await chQuery<{
    paid_24h: string;
    paid_30d: string;
    resi_24h: string;
    resi_30d: string;
  }>({
    query: `
      SELECT countIf(level >= 2 AND recorded_at >= now() - INTERVAL 24 HOUR) AS paid_24h,
             countIf(level >= 2 AND recorded_at >= now() - INTERVAL 30 DAY) AS paid_30d,
             countIf(level >= 3 AND recorded_at >= now() - INTERVAL 24 HOUR) AS resi_24h,
             countIf(level >= 3 AND recorded_at >= now() - INTERVAL 30 DAY) AS resi_30d
      FROM scrape_runs
    `,
  });
  const aiRows = await chQuery<{ ai_24h: string; ai_30d: string }>({
    query: `
      SELECT countIf(recorded_at >= now() - INTERVAL 24 HOUR) AS ai_24h,
             countIf(recorded_at >= now() - INTERVAL 30 DAY) AS ai_30d
      FROM ai_runs
    `,
  });
  const chSizeRows = await chQuery<{ bytes: string }>({
    query: `SELECT sum(bytes_on_disk) AS bytes FROM system.parts WHERE database = 'outrival' AND active`,
  });

  let postgresBytes: number | null = null;
  try {
    const rows = (await db.execute(
      sql`SELECT pg_database_size(current_database()) AS bytes`,
    )) as unknown as Array<{ bytes: string | number }>;
    postgresBytes = rows[0] ? num(rows[0].bytes) : null;
  } catch (err) {
    logger.error({ err }, "pg_database_size query failed");
  }

  const paid24h = num(proxyRows[0]?.paid_24h);
  const paid30d = num(proxyRows[0]?.paid_30d);
  const resi24h = num(proxyRows[0]?.resi_24h);
  const resi30d = num(proxyRows[0]?.resi_30d);
  const ai24h = num(aiRows[0]?.ai_24h);
  const ai30d = num(aiRows[0]?.ai_30d);

  return c.json({
    estimated: true,
    proxy: {
      // paid (level >= 2) scrapes; residential (>= 3) drives the variable cost.
      scrapes24h: paid24h,
      scrapes30d: paid30d,
      fixedUsdPerMonth: DATACENTER_FIXED_USD_PER_MONTH,
      estUsd24h: DATACENTER_FIXED_USD_PER_MONTH / 30 + resi24h * USD_PER_RESIDENTIAL_SCRAPE,
      estUsd30d: DATACENTER_FIXED_USD_PER_MONTH + resi30d * USD_PER_RESIDENTIAL_SCRAPE,
    },
    ai: {
      calls24h: ai24h,
      calls30d: ai30d,
      estUsd24h: ai24h * USD_PER_AI_CALL,
      estUsd30d: ai30d * USD_PER_AI_CALL,
    },
    storage: {
      postgresBytes,
      clickhouseBytes: chSizeRows[0] ? num(chSizeRows[0].bytes) : null,
      r2Bytes: null, // not measured (no cheap usage API) — tracked separately
    },
  });
});

// --- Trigger.dev runs (every job that ran, not just scrape/AI) ---
adminRouter.get("/jobs", async (c) => {
  const statusParam = c.req.query("status"); // CSV of RunStatus
  const taskParam = c.req.query("task");
  const after = c.req.query("after");

  const opts: Record<string, unknown> = { limit: 25 };
  if (after) opts.after = after;
  if (taskParam) opts.taskIdentifier = taskParam;
  if (statusParam) opts.status = statusParam.split(",");

  try {
    const page = await runs.list(opts as unknown as Parameters<typeof runs.list>[0]);
    const out = page.data.map((r) => ({
      id: r.id,
      taskIdentifier: r.taskIdentifier,
      status: r.status,
      isTest: r.isTest,
      version: r.version ?? null,
      createdAt: r.createdAt,
      startedAt: r.startedAt ?? null,
      finishedAt: r.finishedAt ?? null,
      durationMs: r.durationMs ?? null,
      costInCents: r.costInCents ?? null,
    }));
    return c.json({ runs: out, nextCursor: page.pagination?.next ?? null });
  } catch (err) {
    logger.error({ err }, "trigger runs.list failed");
    return c.json({ runs: [], nextCursor: null, error: "trigger_unavailable" });
  }
});

adminRouter.get("/jobs/:id", async (c) => {
  try {
    const r = await runs.retrieve(c.req.param("id"));
    return c.json({
      run: {
        id: r.id,
        taskIdentifier: r.taskIdentifier,
        status: r.status,
        isTest: r.isTest,
        version: r.version ?? null,
        createdAt: r.createdAt,
        startedAt: r.startedAt ?? null,
        finishedAt: r.finishedAt ?? null,
        durationMs: r.durationMs ?? null,
        costInCents: r.costInCents ?? null,
        attemptCount: (r as { attemptCount?: number }).attemptCount ?? null,
        error: r.error ? (r.error.message ?? r.error.name ?? "error") : null,
        payload: r.payload ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, "trigger runs.retrieve failed");
    return c.json({ error: "Not found" }, 404);
  }
});

// --- User/org search ---
adminRouter.get("/users", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const pattern = `%${q}%`;
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
      orgId: organizations.id,
      orgName: organizations.name,
      plan: organizations.plan,
    })
    .from(users)
    .leftJoin(organizations, eq(organizations.id, users.orgId))
    .where(
      q
        ? or(
            ilike(users.email, pattern),
            ilike(users.name, pattern),
            ilike(organizations.name, pattern),
          )
        : undefined,
    )
    .orderBy(desc(users.createdAt))
    .limit(50);

  return c.json({ users: rows });
});

// --- User detail: org, competitors, monitors + last scrape of each ---
adminRouter.get("/users/:id", async (c) => {
  const id = c.req.param("id");
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!user) return c.json({ error: "Not found" }, 404);

  const org = user.orgId
    ? await db.query.organizations.findFirst({ where: eq(organizations.id, user.orgId) })
    : null;

  const comps = org
    ? await db
        .select({
          id: competitors.id,
          name: competitors.name,
          url: competitors.url,
          type: competitors.type,
        })
        .from(competitors)
        .where(and(eq(competitors.orgId, org.id), isNull(competitors.deletedAt)))
    : [];

  const monitorRows = comps.length
    ? await db
        .select({
          id: monitors.id,
          competitorId: monitors.competitorId,
          sourceType: monitors.sourceType,
          isActive: monitors.isActive,
          requiresLevel: monitors.requiresLevel,
          markedUnscrapable: monitors.markedUnscrapable,
          lastRunAt: monitors.lastRunAt,
          nextRunAt: monitors.nextRunAt,
          lastChangedAt: monitors.lastChangedAt,
          lastFailedAt: monitors.lastFailedAt,
          lastError: monitors.lastError,
        })
        .from(monitors)
        .where(
          inArray(
            monitors.competitorId,
            comps.map((x) => x.id),
          ),
        )
    : [];

  const monitorsByCompetitor = comps.map((comp) => ({
    ...comp,
    monitors: monitorRows.filter((m) => m.competitorId === comp.id),
  }));

  await logAudit(c.get("user").email, "view_user", "user", id, { email: user.email });

  return c.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt },
    org: org
      ? { id: org.id, name: org.name, slug: org.slug, plan: org.plan, planPeriod: org.planPeriod }
      : null,
    competitors: monitorsByCompetitor,
  });
});

// --- Force a scrape of a monitor ---
adminRouter.post("/monitors/:id/force-scrape", async (c) => {
  const id = c.req.param("id");
  const monitor = await db.query.monitors.findFirst({ where: eq(monitors.id, id) });
  if (!monitor) return c.json({ error: "Not found" }, 404);

  const handle = await tasks.trigger("scrape-monitor", { monitorId: id, force: true });
  await logAudit(c.get("user").email, "force_scrape", "monitor", id, {
    competitorId: monitor.competitorId,
    sourceType: monitor.sourceType,
  });

  return c.json({ ok: true, runId: handle.id });
});

// --- Feedback (rich view, patch-05) ---
adminRouter.get("/feedback", async (c) => {
  const status = c.req.query("status");
  const valid = status === "new" || status === "reviewed" || status === "resolved";
  const rows = await db
    .select({
      id: feedback.id,
      type: feedback.type,
      message: feedback.message,
      pageUrl: feedback.pageUrl,
      consoleErrors: feedback.consoleErrors,
      screenshotR2Key: feedback.screenshotR2Key,
      userAgent: feedback.userAgent,
      status: feedback.status,
      createdAt: feedback.createdAt,
      orgId: feedback.orgId,
      userEmail: users.email,
    })
    .from(feedback)
    .leftJoin(users, eq(users.id, feedback.userId))
    .where(valid ? eq(feedback.status, status) : undefined)
    .orderBy(desc(feedback.createdAt))
    .limit(100);

  return c.json({ feedback: rows });
});

// Stream a feedback screenshot from R2 (admin-only — the route is gated above).
adminRouter.get("/feedback/:id/screenshot", async (c) => {
  const id = c.req.param("id");
  const row = await db.query.feedback.findFirst({ where: eq(feedback.id, id) });
  if (!row?.screenshotR2Key) return c.json({ error: "Not found" }, 404);
  try {
    const bytes = await getBytesFromR2(row.screenshotR2Key);
    const contentType = row.screenshotR2Key.endsWith(".png") ? "image/png" : "image/jpeg";
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": contentType } });
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});

adminRouter.patch("/feedback/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ status: z.enum(["new", "reviewed", "resolved"]) }).safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid input" }, 400);

  const [updated] = await db
    .update(feedback)
    .set({ status: parsed.data.status })
    .where(eq(feedback.id, id))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);

  await logAudit(c.get("user").email, "update_feedback", "feedback", id, {
    status: parsed.data.status,
  });

  return c.json({ ok: true });
});

// --- Audit log (most recent admin actions) ---
adminRouter.get("/audit-log", async (c) => {
  const rows = await db.query.auditLog.findMany({
    orderBy: desc(auditLog.createdAt),
    limit: 100,
  });
  return c.json({ auditLog: rows });
});

// --- Quality feedback ops (patch-21) ---

type VerdictKey = "useful" | "not_useful" | "neutral";

// Verdict mix per AI output type + the org-wide NPS over the last 30 days.
adminRouter.get("/feedback-quality/stats", async (c) => {
  const period = c.req.query("period") === "30d" ? 30 : 7;
  const cutoff = new Date(Date.now() - period * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      targetType: qualityFeedback.targetType,
      verdict: qualityFeedback.verdict,
      count: sql<number>`count(*)::int`,
    })
    .from(qualityFeedback)
    .where(gte(qualityFeedback.createdAt, cutoff))
    .groupBy(qualityFeedback.targetType, qualityFeedback.verdict);

  const byType: Record<
    string,
    { useful: number; not_useful: number; neutral: number; total: number; notUsefulRate: number }
  > = {};
  for (const r of rows) {
    const t = (byType[r.targetType] ??= {
      useful: 0,
      not_useful: 0,
      neutral: 0,
      total: 0,
      notUsefulRate: 0,
    });
    t[r.verdict as VerdictKey] += r.count;
    t.total += r.count;
  }
  for (const t of Object.values(byType)) {
    t.notUsefulRate = t.total > 0 ? t.not_useful / t.total : 0;
  }

  // NPS always over a fixed 30-day window (the prompt is monthly).
  const npsCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const npsRows = await db
    .select({ score: qualityFeedback.npsScore })
    .from(qualityFeedback)
    .where(and(eq(qualityFeedback.targetType, "nps"), gte(qualityFeedback.createdAt, npsCutoff)));
  const scores = npsRows
    .map((r) => r.score)
    .filter((s): s is number => typeof s === "number");
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const nps = {
    score:
      scores.length > 0
        ? Math.round(((promoters - detractors) / scores.length) * 100)
        : null,
    responses: scores.length,
    average:
      scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
        : null,
    promoters,
    detractors,
  };

  return c.json({ period, byType, nps });
});

// Patterns worth fixing: per type over 14 days, flag a high not-useful rate above
// a minimum sample, with the top reasons for context (never an auto-adjustment).
adminRouter.get("/feedback-quality/patterns", async (c) => {
  const minCount = Number(process.env.FEEDBACK_AGGREGATE_MIN_COUNT ?? 5);
  const windowDays = 14;
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const verdictRows = await db
    .select({
      targetType: qualityFeedback.targetType,
      verdict: qualityFeedback.verdict,
      count: sql<number>`count(*)::int`,
    })
    .from(qualityFeedback)
    .where(gte(qualityFeedback.createdAt, cutoff))
    .groupBy(qualityFeedback.targetType, qualityFeedback.verdict);

  const reasonRows = await db
    .select({
      targetType: qualityFeedback.targetType,
      reason: qualityFeedback.reason,
      count: sql<number>`count(*)::int`,
    })
    .from(qualityFeedback)
    .where(and(gte(qualityFeedback.createdAt, cutoff), eq(qualityFeedback.verdict, "not_useful")))
    .groupBy(qualityFeedback.targetType, qualityFeedback.reason);

  const totals: Record<string, { total: number; notUseful: number }> = {};
  for (const r of verdictRows) {
    const t = (totals[r.targetType] ??= { total: 0, notUseful: 0 });
    t.total += r.count;
    if (r.verdict === "not_useful") t.notUseful += r.count;
  }

  const reasonsByType: Record<string, Array<{ reason: string; count: number }>> = {};
  for (const r of reasonRows) {
    (reasonsByType[r.targetType] ??= []).push({
      reason: r.reason ?? "unspecified",
      count: r.count,
    });
  }

  const patterns = Object.entries(totals)
    .map(([targetType, t]) => ({
      targetType,
      total: t.total,
      notUseful: t.notUseful,
      notUsefulRate: t.total > 0 ? t.notUseful / t.total : 0,
      topReasons: (reasonsByType[targetType] ?? []).sort((a, b) => b.count - a.count).slice(0, 3),
    }))
    .filter((p) => p.total >= minCount && p.notUsefulRate > 0.6)
    .sort((a, b) => b.notUsefulRate - a.notUsefulRate);

  return c.json({ windowDays, minCount, patterns });
});

// patch-23 — scraping edge cases overview: failure categories (latest diagnosis
// per monitor, last 7 days), proposed alternatives and their outcomes, structural
// changes, and SPA API-capture adoption. Used to calibrate the heuristics.
adminRouter.get("/scraping-edge-cases", async (c) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const failureRows = await db
    .select({ category: monitors.lastFailureCategory, count: sql<number>`count(*)::int` })
    .from(monitors)
    .where(
      and(
        isNotNull(monitors.lastFailureCategory),
        gte(monitors.lastFailureDiagnosedAt, sevenDaysAgo),
      ),
    )
    .groupBy(monitors.lastFailureCategory);
  const failuresByCategory: Record<string, number> = {};
  for (const r of failureRows) if (r.category) failuresByCategory[r.category] = r.count;

  const altRows = await db
    .select({ status: monitorAlternatives.status, count: sql<number>`count(*)::int` })
    .from(monitorAlternatives)
    .groupBy(monitorAlternatives.status);
  const alternativesByStatus: Record<string, number> = {};
  for (const r of altRows) alternativesByStatus[r.status] = r.count;

  const structRows = await db
    .select({ status: structuralChanges.status, count: sql<number>`count(*)::int` })
    .from(structuralChanges)
    .groupBy(structuralChanges.status);
  const structuralByStatus: Record<string, number> = {};
  for (const r of structRows) structuralByStatus[r.status] = r.count;

  const [capture] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(monitors)
    .where(eq(monitors.apiCaptureEnabled, true));

  return c.json({
    windowDays: 7,
    failuresByCategory,
    alternativesByStatus,
    structuralByStatus,
    apiCaptureEnabledMonitors: capture?.count ?? 0,
  });
});

// --- AI review queue + quality metrics (patch-24) ---

// Flagged outputs awaiting a human verdict, plus the 30-day header stats.
adminRouter.get("/ai-review-queue", async (c) => {
  const [items, stats] = await Promise.all([
    listFlaggedQualityChecks(100),
    getQualityReviewStats(30),
  ]);
  return c.json({ items, stats });
});

const ResolveSchema = z.object({
  resolution: z.enum(["correct", "hallucination_confirmed", "false_positive"]),
});

adminRouter.post("/ai-review/:id/resolve", async (c) => {
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
adminRouter.get("/ai-quality-metrics", async (c) => {
  const [stats, byTask, confidence] = await Promise.all([
    getQualityReviewStats(30),
    getQualityByTask(30),
    getConfidenceDistribution(30),
  ]);
  return c.json({ windowDays: 30, stats, byTask, confidence });
});

// Onboarding metrics from onboarding_sessions (patch-25). Computed in JS — the
// 30d row count is small — over the per-milestone timings: step durations
// (median/p90/p95), funnel drop-off, status + mode split. No PostHog/ClickHouse
// dependency (PostHog events aren't queryable there).
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? null;
}

const ONBOARDING_SEGMENTS: Array<{ key: string; label: string; from: string; to: string }> = [
  { key: "analyze", label: "URL → Product analyzed", from: "product_url_submitted", to: "product_analyzed" },
  { key: "review", label: "Analyzed → Profile confirmed", from: "product_analyzed", to: "product_profile_confirmed" },
  { key: "discovery", label: "Profile → Discovery completed", from: "product_profile_confirmed", to: "discovery_completed" },
  { key: "choose", label: "Discovery → Competitors finalized", from: "discovery_completed", to: "competitors_finalized" },
  { key: "first_signal", label: "Finalized → First signal", from: "competitors_finalized", to: "first_signal_received" },
  { key: "aha", label: "Signup → First signal", from: "started", to: "first_signal_received" },
  { key: "full", label: "Signup → Analysis completed", from: "started", to: "analysis_completed" },
];

// Funnel stages by milestone key, in order — drop-off is measured between them.
const ONBOARDING_FUNNEL: Array<{ key: string; label: string }> = [
  { key: "started", label: "Started" },
  { key: "product_analyzed", label: "Product analyzed" },
  { key: "product_profile_confirmed", label: "Profile confirmed" },
  { key: "discovery_completed", label: "Discovery completed" },
  { key: "competitors_finalized", label: "Competitors finalized" },
  { key: "analysis_completed", label: "Analysis completed" },
];

adminRouter.get("/onboarding-metrics", async (c) => {
  const windowDays = 30;
  const cutoff = new Date(Date.now() - windowDays * 86_400_000);
  const rows = await db
    .select({
      stage: onboardingSessions.stage,
      mode: onboardingSessions.mode,
      timings: onboardingSessions.timings,
    })
    .from(onboardingSessions)
    .where(gte(onboardingSessions.startedAt, cutoff));

  const total = rows.length;
  const byStatus = { completed: 0, abandoned: 0, inProgress: 0, other: 0 };
  const modeSplit = { quick_start: 0, full: 0 };
  for (const r of rows) {
    if (r.stage === "completed") byStatus.completed += 1;
    else if (r.stage === "abandoned") byStatus.abandoned += 1;
    else if (r.stage === "analysis_in_progress") byStatus.inProgress += 1;
    else byStatus.other += 1;
    if (r.mode === "full") modeSplit.full += 1;
    else modeSplit.quick_start += 1;
  }

  const segments = ONBOARDING_SEGMENTS.map((seg) => {
    const durations: number[] = [];
    for (const r of rows) {
      const t = (r.timings ?? {}) as Record<string, number>;
      const a = t[seg.from];
      const b = t[seg.to];
      if (typeof a === "number" && typeof b === "number" && b >= a) durations.push(b - a);
    }
    return {
      key: seg.key,
      label: seg.label,
      count: durations.length,
      medianMs: percentile(durations, 50),
      p90Ms: percentile(durations, 90),
      p95Ms: percentile(durations, 95),
    };
  });

  let prevReached: number | null = null;
  const funnel = ONBOARDING_FUNNEL.map((stage) => {
    const reached = rows.filter((r) => {
      const t = (r.timings ?? {}) as Record<string, number>;
      return typeof t[stage.key] === "number";
    }).length;
    const dropoffPct =
      prevReached && prevReached > 0 ? (prevReached - reached) / prevReached : null;
    prevReached = reached;
    return { key: stage.key, label: stage.label, reached, dropoffPct };
  });

  return c.json({ windowDays, total, byStatus, modeSplit, segments, funnel });
});
