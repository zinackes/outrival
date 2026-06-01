import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, ne, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db,
  organizations,
  users,
  competitors,
  monitors,
  signals,
  feedback,
  auditLog,
} from "@outrival/db";
import { getBytesFromR2, logger } from "@outrival/shared";
import { tasks, runs } from "@trigger.dev/sdk/v3";
import { authMiddleware } from "../middleware/auth";
import { adminMiddleware } from "../middleware/admin";
import { chQuery } from "../lib/clickhouse-safe";

// --- Cost estimation constants. TRENDS, not accounting. Documented in
//     findings.md § Patch-02. Tune as real invoices come in. ---
// ScrapingBee premium_proxy ≈ 25 credits/request; $49 buys 100k credits.
const SCRAPINGBEE_CREDITS_PER_PROXY = 25;
const SCRAPINGBEE_USD_PER_CREDIT = 49 / 100_000;
const USD_PER_PROXY_SCRAPE = SCRAPINGBEE_CREDITS_PER_PROXY * SCRAPINGBEE_USD_PER_CREDIT;
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
             countIf(used_proxy = 1) AS proxy,
             round(avg(duration_ms)) AS avg_ms
      FROM scrape_runs
      WHERE recorded_at >= now() - INTERVAL 24 HOUR
      GROUP BY source_type
      ORDER BY total DESC
    `,
  });

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

  return c.json({ window: "24h", sources, deadMonitors });
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

  return c.json({
    window: "7d",
    tasks: tasksHealth,
    signalsByDay: signalsByDay.map((r) => ({ day: r.day, count: num(r.count) })),
  });
});

// --- Cost: trend estimates (NOT accounting), clearly flagged ---
adminRouter.get("/cost", async (c) => {
  const proxyRows = await chQuery<{ proxy_24h: string; proxy_30d: string }>({
    query: `
      SELECT countIf(used_proxy = 1 AND recorded_at >= now() - INTERVAL 24 HOUR) AS proxy_24h,
             countIf(used_proxy = 1 AND recorded_at >= now() - INTERVAL 30 DAY) AS proxy_30d
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

  const proxy24h = num(proxyRows[0]?.proxy_24h);
  const proxy30d = num(proxyRows[0]?.proxy_30d);
  const ai24h = num(aiRows[0]?.ai_24h);
  const ai30d = num(aiRows[0]?.ai_30d);

  return c.json({
    estimated: true,
    proxy: {
      scrapes24h: proxy24h,
      scrapes30d: proxy30d,
      creditsPerScrape: SCRAPINGBEE_CREDITS_PER_PROXY,
      estUsd24h: proxy24h * USD_PER_PROXY_SCRAPE,
      estUsd30d: proxy30d * USD_PER_PROXY_SCRAPE,
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
          requiresProxy: monitors.requiresProxy,
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
