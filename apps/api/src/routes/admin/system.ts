import os from "node:os";
import { Hono } from "hono";
import { and, eq, gte, sql } from "drizzle-orm";
import { Resend } from "resend";
import {
  db,
  users,
  organizations,
  signals,
  onboardingSessions,
  standingQueries,
  shareLinks,
  crmDestinations,
  askHistory,
  signalComments,
  savedViews,
  passkey,
} from "@outrival/db";
import { logger, getRedis, FEATURE_FLAGS } from "@outrival/shared";
import { checkGlobalBreaker } from "@outrival/ai";
import { getStripe } from "../../lib/stripe";
import { analyticsQuery } from "../../lib/analytics-safe";
import { num, rate, type AdminVariables } from "./shared";
import {
  getQueueRows,
  getRecentFailures,
  getThroughput,
  getScheduleRows,
  listDeadLetter,
} from "../../lib/queue-admin";

export const systemRouter = new Hono<{ Variables: AdminVariables }>();

// We don't paginate the failure/throughput lists — a single capped page is
// enough to spot a backlog or a spike without scanning the whole job table.
const FAILED_CAP = 50;
const DURATION_SAMPLE = 50;
const DLQ_CAP = 25;

// B2 (patch admin-v2) — job queue + cron health, now read from pg-boss instead of
// the Trigger.dev management API. The AGGREGATE view that /admin/jobs (raw,
// filterable job list) doesn't give: per-queue backlog, the 24h failure count,
// recent throughput, schedule freshness, and the dead-letter queue.
//
// Every section is guarded INDEPENDENTLY (each reader returns null on failure):
// the queue lives on its own Postgres, so an outage there degrades a panel to
// `available: false` — never a 500 on the whole page.
systemRouter.get("/queue-health", async (c) => {
  const configured = !!process.env.QUEUE_DATABASE_URL;

  // Queue backlog + executing, straight from pg-boss's own counters.
  const queueRows = configured ? await getQueueRows() : null;
  const totalQueued = (queueRows ?? []).reduce((n, q) => n + q.queued, 0);
  const totalRunning = (queueRows ?? []).reduce((n, q) => n + q.running, 0);
  const totalFailed = (queueRows ?? []).reduce((n, q) => n + q.failed, 0);

  const failedRows = configured ? await getRecentFailures(FAILED_CAP) : null;
  const throughput = configured ? await getThroughput(DURATION_SAMPLE) : null;
  const scheduleRows = configured ? await getScheduleRows() : null;
  const deadLetterRows = configured ? await listDeadLetter(DLQ_CAP) : null;

  return c.json({
    configured,
    queues: {
      available: queueRows !== null,
      totalQueued,
      totalRunning,
      totalFailed,
      rows: queueRows ?? [],
    },
    failures24h: {
      available: failedRows !== null,
      count: failedRows?.length ?? 0,
      capped: (failedRows?.length ?? 0) >= FAILED_CAP,
      rows: failedRows ?? [],
    },
    throughput24h: {
      available: throughput !== null,
      avgDurationMs: throughput?.avgDurationMs ?? null,
      sampled: throughput?.sampled ?? 0,
    },
    schedules: {
      available: scheduleRows !== null,
      activeCount: scheduleRows?.length ?? 0,
      rows: scheduleRows ?? [],
    },
    // Jobs that exhausted their retries. Empty is the healthy state — this panel
    // exists so an exhausted scrape/signal job can't fail silently the way a
    // vanished Trigger run could.
    deadLetter: {
      available: deadLetterRows !== null,
      count: deadLetterRows?.length ?? 0,
      rows: deadLetterRows ?? [],
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

// --- Capability liveness readout (plan 021) ---
// Every optional capability behind a switch/key/plan flag, answered behaviourally:
// has it written a row recently? The API and workers are separate services with
// separate environments, so an env read is only meaningful for a capability that
// is genuinely API-side (visual_diff) — everything else is probed from a trace it
// already leaves in an existing table. No env value ever appears below: booleans
// and counts only, matching /dependencies above.
type CapabilityStatus = {
  key: string;
  label: string;
  observable: boolean;
  live: boolean;
  count: number;
  note: string | null;
};

const CAPABILITY_WINDOW_DAYS = 30;
const CAP_CACHE_MS = 60_000;
let capCache: {
  at: number;
  payload: { checkedAt: string; capabilities: CapabilityStatus[] };
} | null = null;

systemRouter.get("/capabilities", async (c) => {
  if (capCache && Date.now() - capCache.at < CAP_CACHE_MS) {
    return c.json({ ...capCache.payload, cached: true });
  }

  const windowSql = sql`now() - make_interval(days => ${CAPABILITY_WINDOW_DAYS})`;

  const [backfillRows, extractionRows, platformRows, aiVisibilityRows] = await Promise.all([
    analyticsQuery<{ n: string }>(
      sql`SELECT count(*) AS n FROM backfill_runs WHERE recorded_at >= ${windowSql}`,
    ),
    analyticsQuery<{ total: string; non_floor: string }>(sql`
      SELECT count(*) AS total, count(*) FILTER (WHERE resolution <> 'ai_fallback') AS non_floor
      FROM extraction_runs WHERE recorded_at >= ${windowSql}
    `),
    analyticsQuery<{ n: string }>(
      sql`SELECT count(*) AS n FROM platform_detection_runs WHERE recorded_at >= ${windowSql}`,
    ),
    analyticsQuery<{ n: string }>(
      sql`SELECT count(*) AS n FROM ai_visibility_results WHERE recorded_at >= ${windowSql}`,
    ),
  ]);

  const windowStart = new Date(Date.now() - CAPABILITY_WINDOW_DAYS * 86_400_000);

  const [faithfulnessRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(signals)
    .where(and(gte(signals.createdAt, windowStart), sql`${signals.faithfulness} IS NOT NULL`));

  const [standingRow] = await db
    .select({
      evaluated: sql<number>`count(*) filter (where ${standingQueries.lastEvaluatedAt} is not null)::int`,
      dormant: sql<number>`count(*) filter (where ${standingQueries.lastEvaluatedAt} is null)::int`,
    })
    .from(standingQueries)
    .where(eq(standingQueries.isActive, true));

  const [shareLinksRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(shareLinks)
    .where(sql`${shareLinks.revokedAt} IS NULL`);

  const [crmRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(crmDestinations)
    .where(eq(crmDestinations.enabled, true));

  const [askRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(askHistory)
    .where(gte(askHistory.createdAt, windowStart));

  const [commentsRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(signalComments)
    .where(gte(signalComments.createdAt, windowStart));

  const [savedViewsRow] = await db.select({ n: sql<number>`count(*)::int` }).from(savedViews);
  const [passkeyRow] = await db.select({ n: sql<number>`count(*)::int` }).from(passkey);

  const backfillCount = num(backfillRows[0]?.n);
  const extractionTotal = num(extractionRows[0]?.total);
  const extractionNonFloor = num(extractionRows[0]?.non_floor);
  const platformCount = num(platformRows[0]?.n);
  const aiVisibilityCount = num(aiVisibilityRows[0]?.n);
  const faithfulnessCount = faithfulnessRow?.n ?? 0;
  const standingEvaluated = standingRow?.evaluated ?? 0;
  const standingDormant = standingRow?.dormant ?? 0;
  const shareLinksCount = shareLinksRow?.n ?? 0;
  const crmCount = crmRow?.n ?? 0;
  const askCount = askRow?.n ?? 0;
  const commentsCount = commentsRow?.n ?? 0;
  const savedViewsCount = savedViewsRow?.n ?? 0;
  const passkeyCount = passkeyRow?.n ?? 0;

  const capabilities: CapabilityStatus[] = [
    {
      key: "archive_backfill",
      label: "Archive backfill",
      observable: true,
      live: backfillCount > 0,
      count: backfillCount,
      note: null,
    },
    {
      key: "staged_extraction",
      label: "Staged extraction",
      observable: true,
      live: extractionNonFloor > 0,
      count: extractionNonFloor,
      note:
        extractionTotal > 0 && extractionNonFloor === 0
          ? "Every resolution in the window was the AI fallback floor; the staged tiers are not resolving anything themselves."
          : null,
    },
    {
      key: "platform_detection",
      label: "Platform detection",
      observable: true,
      live: platformCount > 0,
      count: platformCount,
      note: null,
    },
    {
      key: "ai_visibility",
      label: "AI Visibility",
      observable: true,
      live: aiVisibilityCount > 0,
      count: aiVisibilityCount,
      note: null,
    },
    {
      key: "faithfulness_gate",
      label: "Faithfulness gate",
      observable: true,
      live: faithfulnessCount > 0,
      count: faithfulnessCount,
      note: null,
    },
    {
      key: "standing_queries",
      label: "Standing queries",
      observable: true,
      live: standingEvaluated > 0,
      count: standingEvaluated,
      note:
        standingDormant > 0
          ? `${standingDormant} active but never evaluated, the dormant-secret symptom.`
          : null,
    },
    {
      key: "share_links",
      label: "Share links",
      observable: true,
      live: shareLinksCount > 0,
      count: shareLinksCount,
      note: null,
    },
    {
      key: "crm_webhook",
      label: "CRM webhook",
      observable: true,
      live: crmCount > 0,
      count: crmCount,
      note: null,
    },
    {
      key: "ask",
      label: "Ask Outrival",
      observable: true,
      live: askCount > 0,
      count: askCount,
      note: null,
    },
    {
      key: "signal_comments",
      label: "Signal comments",
      observable: true,
      live: commentsCount > 0,
      count: commentsCount,
      note: null,
    },
    {
      key: "saved_views",
      label: "Saved views",
      observable: true,
      live: savedViewsCount > 0,
      count: savedViewsCount,
      note: null,
    },
    {
      key: "passkeys",
      label: "Passkeys",
      observable: true,
      live: passkeyCount > 0,
      count: passkeyCount,
      note: null,
    },
    {
      key: "visual_diff",
      label: "Visual diff",
      observable: true,
      live: process.env.VISUAL_DIFF_ENABLED !== "false",
      count: 0,
      note: null,
    },
    {
      key: "multi_user",
      label: "Multi-user orgs",
      observable: true,
      live: FEATURE_FLAGS.multiUser,
      count: 0,
      note: "Deliberately off, see docs/paid-feature-delivery.md.",
    },
  ];

  const payload = { checkedAt: new Date().toISOString(), capabilities };
  capCache = { at: Date.now(), payload };
  return c.json({ ...payload, cached: false });
});

// --- B1: host (web + API) resources ---
// This is the VPS that runs Next.js (web) + Hono (API) — NOT scraping. Scraping
// browsers run on the separate workers box (WORKER_ROLE=browser), so the
// scraping-capacity signal is the queue backlog (see /queue-health), not RAM here. os.* reads the
// host; on a cgroup-limited container totalmem may report the host, not the
// container limit — fine for a single-tenant VPS.
systemRouter.get("/host-health", (c) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const load = os.loadavg();
  const cores = os.cpus().length || 1;
  return c.json({
    memory: {
      totalMb: Math.round(totalMem / 1e6),
      usedMb: Math.round(usedMem / 1e6),
      usedPct: totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0,
    },
    cpu: {
      load1: Math.round((load[0] ?? 0) * 100) / 100,
      load5: Math.round((load[1] ?? 0) * 100) / 100,
      load15: Math.round((load[2] ?? 0) * 100) / 100,
      cores,
      loadPctOfCores: Math.round(((load[0] ?? 0) / cores) * 100),
    },
    uptimeSec: Math.round(os.uptime()),
  });
});

// --- B4: error-rate spike view (1h vs 24h) ---
// Doesn't re-do error monitoring (Sentry captures exceptions in prod) — surfaces
// the in-house failure signals we already log: AI runs (error / parse_failed)
// and scrapes (failed). The 1h window next to 24h is the spike signal the
// /admin/ai (7d) and /admin/scraping (24h) detail pages don't give. Best-effort:
// analyticsQuery returns [] if the analytics store is unreachable → all zeros.
systemRouter.get("/error-rates", async (c) => {
  const [aiRow] = await analyticsQuery<{
    total_1h: string;
    err_1h: string;
    pf_1h: string;
    total_24h: string;
    err_24h: string;
    pf_24h: string;
  }>(sql`
    SELECT
      count(*) filter (where recorded_at >= now() - make_interval(hours => 1)) AS total_1h,
      count(*) filter (where status = 'error' and recorded_at >= now() - make_interval(hours => 1)) AS err_1h,
      count(*) filter (where status = 'parse_failed' and recorded_at >= now() - make_interval(hours => 1)) AS pf_1h,
      count(*) AS total_24h,
      count(*) filter (where status = 'error') AS err_24h,
      count(*) filter (where status = 'parse_failed') AS pf_24h
    FROM ai_runs
    WHERE recorded_at >= now() - make_interval(hours => 24)
  `);

  const [scrapeRow] = await analyticsQuery<{
    total_1h: string;
    failed_1h: string;
    total_24h: string;
    failed_24h: string;
  }>(sql`
    SELECT
      count(*) filter (where recorded_at >= now() - make_interval(hours => 1)) AS total_1h,
      count(*) filter (where status = 'failed' and recorded_at >= now() - make_interval(hours => 1)) AS failed_1h,
      count(*) AS total_24h,
      count(*) filter (where status = 'failed') AS failed_24h
    FROM scrape_runs
    WHERE recorded_at >= now() - make_interval(hours => 24)
  `);

  const aiWindow = (total: number, errors: number, parseFailed: number) => ({
    total,
    errors,
    parseFailed,
    failureRate: rate(errors + parseFailed, total),
  });
  const scrapeWindow = (total: number, failed: number) => ({
    total,
    failed,
    failureRate: rate(failed, total),
  });

  return c.json({
    ai: {
      h1: aiWindow(num(aiRow?.total_1h), num(aiRow?.err_1h), num(aiRow?.pf_1h)),
      h24: aiWindow(num(aiRow?.total_24h), num(aiRow?.err_24h), num(aiRow?.pf_24h)),
    },
    scrape: {
      h1: scrapeWindow(num(scrapeRow?.total_1h), num(scrapeRow?.failed_1h)),
      h24: scrapeWindow(num(scrapeRow?.total_24h), num(scrapeRow?.failed_24h)),
    },
  });
});

// --- Product KPIs (admin-v2 Produit) ---
// Anti-reinvention: PostHog keeps the deep product analytics (funnels, retention,
// events). The cockpit surfaces 3-4 top-line numbers from data we already track
// in Postgres + a link out to PostHog for the detail.
systemRouter.get("/product-kpis", async (c) => {
  const d7 = new Date(Date.now() - 7 * 86400_000);
  const d30 = new Date(Date.now() - 30 * 86400_000);

  const [newUsersRow, orgRow, signalsRow, onbRow] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(users).where(gte(users.createdAt, d7)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        onboarded: sql<number>`count(*) filter (where ${organizations.onboardingCompleted})::int`,
      })
      .from(organizations),
    db.select({ c: sql<number>`count(*)::int` }).from(signals).where(gte(signals.createdAt, d7)),
    db
      .select({
        started: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${onboardingSessions.completedAt} is not null)::int`,
      })
      .from(onboardingSessions)
      .where(gte(onboardingSessions.startedAt, d30)),
  ]);

  const totalOrgs = orgRow[0]?.total ?? 0;
  const onboardedOrgs = orgRow[0]?.onboarded ?? 0;
  const started = onbRow[0]?.started ?? 0;
  const completed = onbRow[0]?.completed ?? 0;

  return c.json({
    newUsers7d: newUsersRow[0]?.c ?? 0,
    signals7d: signalsRow[0]?.c ?? 0,
    orgs: {
      total: totalOrgs,
      onboarded: onboardedOrgs,
      adoptionRate: rate(onboardedOrgs, totalOrgs),
    },
    onboarding30d: {
      started,
      completed,
      completionRate: rate(completed, started),
    },
  });
});
