import { Hono } from "hono";
import { and, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import {
  db,
  competitors,
  monitors,
  monitorAlternatives,
  structuralChanges,
  signals,
  changes,
  notifications,
  forcedRescanLog,
  organizations,
} from "@outrival/db";
import {
  computeFreshnessState,
  mapSourceTypeToCategory,
  type FreshnessState,
} from "@outrival/shared";
import { analyticsQuery } from "../../lib/analytics-safe";
import { num, rate, type AdminVariables } from "./shared";

// A monitor is "dead" when its most recent N runs are ALL failures.
const DEAD_RUN_THRESHOLD = 3;

export const scrapingRouter = new Hono<{ Variables: AdminVariables }>();

// --- Scraping health: per-source reliability/proxy/duration (24h) + dead monitors ---
scrapingRouter.get("/scraping-health", async (c) => {
  const bySource = await analyticsQuery<{
    source_type: string;
    total: string;
    failed: string;
    proxy: string;
    avg_ms: number;
  }>(sql`
    SELECT source_type,
           count(*) AS total,
           count(*) filter (where status = 'failed') AS failed,
           count(*) filter (where level >= 2) AS proxy,
           round(avg(duration_ms))::int AS avg_ms
    FROM scrape_runs
    WHERE recorded_at >= now() - make_interval(hours => 24)
    GROUP BY source_type
    ORDER BY total DESC
  `);

  // Cascade-level distribution (patch-20): what % of scrapes stay free (L0/L1)
  // vs escalate to paid datacenter (L2) / residential (L3) / Camoufox (L4).
  const levelRows = await analyticsQuery<{ level: number; c: string }>(sql`
    SELECT level, count(*) AS c
    FROM scrape_runs
    WHERE recorded_at >= now() - make_interval(hours => 24)
    GROUP BY level
  `);
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
  const recent = await analyticsQuery<{
    monitor_id: string;
    competitor_id: string;
    source_type: string;
    statuses: string[];
  }>(sql`
    SELECT monitor_id,
           (array_agg(competitor_id ORDER BY recorded_at DESC))[1] AS competitor_id,
           (array_agg(source_type ORDER BY recorded_at DESC))[1] AS source_type,
           array_agg(status ORDER BY recorded_at DESC) AS statuses
    FROM (
      SELECT monitor_id, competitor_id, source_type, status, recorded_at,
             row_number() OVER (PARTITION BY monitor_id ORDER BY recorded_at DESC) AS rn
      FROM scrape_runs
    ) t
    WHERE rn <= 5
    GROUP BY monitor_id
  `);

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

  // Staged extraction resolution (patch-30): how extractions resolved — structured
  // / cache stay free, heal / ai_fallback spend an AI call. The direct arbiter of
  // extraction AI cost (the metric the patch is built around).
  const extractionRows = await analyticsQuery<{ resolution: string; c: string }>(sql`
    SELECT resolution, count(*) AS c
    FROM extraction_runs
    WHERE recorded_at >= now() - make_interval(hours => 24)
    GROUP BY resolution
  `);
  const resCount = (r: string) =>
    num(extractionRows.find((x) => x.resolution === r)?.c ?? "0");
  const extraction = {
    structured: resCount("structured"),
    cache: resCount("cache"),
    heal: resCount("heal"),
    aiFallback: resCount("ai_fallback"),
  };

  return c.json({ window: "24h", sources, levels, extraction, deadMonitors });
});

// patch-23 — scraping edge cases overview: failure categories (latest diagnosis
// per monitor, last 7 days), proposed alternatives and their outcomes, structural
// changes, and SPA API-capture adoption. Used to calibrate the heuristics.
scrapingRouter.get("/scraping-edge-cases", async (c) => {
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

// Patch-27 — monitors health: freshness distribution (what users see as dots),
// red-by-category, silent (no signal in N days), and the forced re-scan
// useful/wasted ratio by tier. Scope mirrors the silent-monitor job.
scrapingRouter.get("/monitors-health", async (c) => {
  const now = new Date();
  const silentDays = Number(process.env.SILENT_MONITOR_ALERT_THRESHOLD_DAYS ?? 60);

  const rows = await db
    .select({
      monitorId: monitors.id,
      sourceType: monitors.sourceType,
      lastRunAt: monitors.lastRunAt,
      lastFailedAt: monitors.lastFailedAt,
      monitorCreatedAt: monitors.createdAt,
    })
    .from(monitors)
    .innerJoin(competitors, eq(monitors.competitorId, competitors.id))
    .where(
      and(
        eq(monitors.isActive, true),
        eq(monitors.markedUnscrapable, false),
        ne(monitors.sourceType, "tech_stack"),
        ne(competitors.type, "self"),
        isNull(competitors.deletedAt),
      ),
    );

  // Freshness state per monitor — based on the last scrape, so this matches the
  // dot users actually see. A failed last scan forces red.
  const distribution: Record<FreshnessState, number> = { fresh: 0, yellow: 0, orange: 0, red: 0 };
  const redByCategory: Record<string, number> = {};
  for (const r of rows) {
    const failed = !!r.lastFailedAt && (!r.lastRunAt || r.lastFailedAt >= r.lastRunAt);
    const { state } = computeFreshnessState(r.lastRunAt ?? null, r.sourceType, now);
    const effective: FreshnessState = failed ? "red" : state;
    distribution[effective] += 1;
    if (effective === "red") {
      const cat = mapSourceTypeToCategory(r.sourceType);
      redByCategory[cat] = (redByCategory[cat] ?? 0) + 1;
    }
  }

  // Silent (no signal in N days) — signal-based, mirrors the ops job.
  const silentCutoffMs = now.getTime() - silentDays * 86_400_000;
  const lastSignalRows = await db
    .select({
      monitorId: changes.monitorId,
      last: sql<string | Date | null>`max(${signals.createdAt})`,
    })
    .from(signals)
    .innerJoin(changes, eq(signals.changeId, changes.id))
    .groupBy(changes.monitorId);
  const lastSignal = new Map<string, number>();
  for (const r of lastSignalRows) {
    if (r.last) lastSignal.set(r.monitorId, new Date(r.last).getTime());
  }
  let silentCount = 0;
  for (const r of rows) {
    const ref = lastSignal.get(r.monitorId) ?? r.monitorCreatedAt.getTime();
    if (ref < silentCutoffMs) silentCount += 1;
  }

  // Forced re-scans (30d): by tier + useful/wasted (only completed runs counted
  // toward the ratio; pending ones haven't reported an outcome yet).
  const cutoff30 = new Date(now.getTime() - 30 * 86_400_000);
  const rescanRows = await db
    .select({
      plan: organizations.plan,
      count: sql<number>`count(*)::int`,
      useful: sql<number>`count(*) filter (where had_new_signal)::int`,
      done: sql<number>`count(*) filter (where result_captured_at is not null)::int`,
    })
    .from(forcedRescanLog)
    .innerJoin(organizations, eq(forcedRescanLog.orgId, organizations.id))
    .where(gte(forcedRescanLog.triggeredAt, cutoff30))
    .groupBy(organizations.plan);
  const byTier: Record<string, number> = {};
  let rescanTotal = 0;
  let rescanUseful = 0;
  let rescanDone = 0;
  for (const r of rescanRows) {
    byTier[r.plan] = r.count;
    rescanTotal += r.count;
    rescanUseful += r.useful;
    rescanDone += r.done;
  }

  const [silentNotifRow] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.type, "silent_monitor"), gte(notifications.createdAt, cutoff30)));

  return c.json({
    period: 30,
    silentThresholdDays: silentDays,
    total: rows.length,
    distribution,
    redByCategory,
    silentCount,
    rescans: {
      total: rescanTotal,
      byTier,
      useful: rescanUseful,
      wasted: rescanDone - rescanUseful,
      usefulRate: rescanDone > 0 ? rescanUseful / rescanDone : 0,
    },
    silentNotificationsSent: silentNotifRow?.value ?? 0,
  });
});
