import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { logger } from "@trigger.dev/sdk/v3";
import { getActiveProvider } from "@outrival/ai";

let client: ClickHouseClient | null = null;

function getClient(): ClickHouseClient | null {
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;
  if (!client) {
    client = createClient({
      url,
      password: process.env.CLICKHOUSE_PASSWORD,
      database: "outrival",
      // Bound cold-start reads/inserts (Cloud idles to zero). keep-warm cron
      // normally prevents the ~30s wake, but never hang a job on a slow service.
      request_timeout: 10000,
    });
  }
  return client;
}

async function queryBestEffort<T>(
  query: string,
  query_params: Record<string, unknown>,
): Promise<T[] | null> {
  const ch = getClient();
  if (!ch) return null;
  try {
    const rs = await ch.query({ query, query_params, format: "JSONEachRow" });
    return await rs.json<T>();
  } catch (err) {
    logger.error("ClickHouse query failed", { err: String(err) });
    return null;
  }
}

// Lightweight query to keep the ClickHouse Cloud service from idling to zero,
// which is what makes the first read after inactivity hang ~30s. Best-effort:
// never throws, so the keep-warm schedule never retries.
export async function pingClickhouse(): Promise<boolean> {
  const ch = getClient();
  if (!ch) {
    logger.warn("ClickHouse not configured, skipping keep-warm ping");
    return false;
  }
  try {
    await ch.query({ query: "SELECT 1", format: "JSONEachRow" });
    return true;
  } catch (err) {
    logger.error("ClickHouse keep-warm ping failed", { err: String(err) });
    return false;
  }
}

async function insertBestEffort(table: string, values: unknown[]): Promise<void> {
  const ch = getClient();
  if (!ch) {
    logger.warn(`ClickHouse not configured, skipping ${table} insert`);
    return;
  }
  try {
    await ch.insert({ table, values, format: "JSONEachRow" });
  } catch (err) {
    logger.error(`ClickHouse insert failed (${table})`, { err: String(err) });
  }
}

export interface SignalFeedRow {
  org_id: string;
  competitor_id: string;
  category: string;
  severity: string;
  recorded_at: Date;
}

export async function insertSignalFeed(row: SignalFeedRow): Promise<void> {
  await insertBestEffort("signal_feed", [row]);
}

// --- Ops observability (patch-02). Best-effort, never throws: an ops-logging
//     failure must never break a scrape or an AI job. ---

export interface ScrapeRunRow {
  monitor_id: string;
  competitor_id: string;
  source_type: string;
  status: "success" | "no_change" | "failed";
  level: number; // patch-20 cascade level: 0/1 free, 2/3/4 paid (ClickHouse UInt8)
  attempts: number;
  failure_reason: string;
  duration_ms: number;
  recorded_at: Date;
}

export async function logScrapeRun(row: ScrapeRunRow): Promise<void> {
  await insertBestEffort("scrape_runs", [row]);
}

export type AiRunStatus = "success" | "parse_failed" | "error";

// The job logs the AI run, never the @outrival/ai task (kept pure, no DB). The
// task returns null on a parse miss → "parse_failed"; a thrown call → "error".
export async function logAiRun(
  task: string,
  provider: string,
  model: string,
  status: AiRunStatus,
): Promise<void> {
  // Prefer the real pool provider the call ran on (cerebras|groq|hyperbolic),
  // captured by complete() in the same async context (patch-22). Falls back to the
  // static provider from AI_CONFIG when the pool didn't run (e.g. Claude fallback).
  const actual = getActiveProvider() ?? provider;
  await insertBestEffort("ai_runs", [
    { task, provider: actual, model, status, recorded_at: new Date() },
  ]);
}

// Wrap an @outrival/ai task call so its outcome lands in ai_runs (patch-02):
// a value → success, null → parse_failed, a throw (e.g. Groq 429 after the SDK's
// own retries) → error, rethrown so Trigger.dev still retries the job. Feeds both
// the admin AI-health panel and the user-facing "AI is catching up" banner — the
// extract/summary jobs went unlogged before, so a rate limit there was silent.
export async function loggedAi<T>(
  task: string,
  config: { provider: string; model: string },
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const res = await fn();
    await logAiRun(task, config.provider, config.model, res == null ? "parse_failed" : "success");
    return res;
  } catch (err) {
    await logAiRun(task, config.provider, config.model, "error");
    throw err;
  }
}

// --- Ops health reads (patch-02, ops-health-check job). Best-effort: null when
//     CH is down/unset → the health check simply skips that threshold. ---

export interface ScrapeHealthWindow {
  total: number;
  failed: number;
  proxy: number; // paid scrapes (level >= 2: datacenter/residential/camoufox)
  residential: number; // level >= 3 (residential + camoufox) — the expensive tier
}

export async function getScrapeHealth(hours: number): Promise<ScrapeHealthWindow | null> {
  const rows = await queryBestEffort<{
    total: string;
    failed: string;
    proxy: string;
    residential: string;
  }>(
    `SELECT count() AS total,
            countIf(status = 'failed') AS failed,
            countIf(level >= 2) AS proxy,
            countIf(level >= 3) AS residential
     FROM scrape_runs
     WHERE recorded_at >= now() - toIntervalHour({h:UInt32})`,
    { h: hours },
  );
  if (!rows || !rows[0]) return null;
  return {
    total: Number(rows[0].total),
    failed: Number(rows[0].failed),
    proxy: Number(rows[0].proxy),
    residential: Number(rows[0].residential),
  };
}

export async function getAiParseHealth(
  hours: number,
): Promise<{ total: number; parseFailed: number } | null> {
  const rows = await queryBestEffort<{ total: string; parse_failed: string }>(
    `SELECT count() AS total, countIf(status = 'parse_failed') AS parse_failed
     FROM ai_runs
     WHERE recorded_at >= now() - toIntervalHour({h:UInt32})`,
    { h: hours },
  );
  if (!rows || !rows[0]) return null;
  return { total: Number(rows[0].total), parseFailed: Number(rows[0].parse_failed) };
}

export async function getRecentSignalCount(hours: number): Promise<number | null> {
  const rows = await queryBestEffort<{ c: string }>(
    `SELECT count() AS c FROM signal_feed
     WHERE recorded_at >= now() - toIntervalHour({h:UInt32})`,
    { h: hours },
  );
  if (!rows || !rows[0]) return null;
  return Number(rows[0].c);
}

export interface PricingHistoryRow {
  competitor_id: string;
  plan_name: string;
  price: number;
  currency: string;
  billing_period: string;
  // patch-11 taxonomy columns. promotional is UInt8 in ClickHouse (0/1).
  status: string;
  promotional: number;
  observed_region: string;
  recorded_at: Date;
}

export async function insertPricingHistory(rows: PricingHistoryRow[]): Promise<void> {
  if (rows.length === 0) return;
  await insertBestEffort("pricing_history", rows);
}

export interface JobCountRow {
  competitor_id: string;
  department: string;
  count: number;
  recorded_at: Date;
}

export async function insertJobCounts(rows: JobCountRow[]): Promise<void> {
  if (rows.length === 0) return;
  await insertBestEffort("job_counts", rows);
}

export interface ReviewScoreRow {
  competitor_id: string;
  source: string;
  score: number;
  review_count: number;
  sentiment_score: number;
  recorded_at: Date;
}

export async function insertReviewScore(row: ReviewScoreRow): Promise<void> {
  await insertBestEffort("review_scores", [row]);
}

// Previous-state reads for the per-source summary. Called BEFORE inserting the
// fresh batch, so "latest in CH" is the prior scrape. Best-effort: null on miss.
export async function getPreviousPricing(
  competitorId: string,
): Promise<PricingHistoryRow[] | null> {
  const rows = await queryBestEffort<PricingHistoryRow>(
    `SELECT plan_name, price, currency, billing_period
     FROM pricing_history
     WHERE competitor_id = {cid:String}
       AND recorded_at = (
         SELECT max(recorded_at) FROM pricing_history WHERE competitor_id = {cid:String}
       )`,
    { cid: competitorId },
  );
  return rows && rows.length > 0 ? rows : null;
}

export async function getPreviousReviewScore(
  competitorId: string,
  source: string,
): Promise<number | null> {
  const rows = await queryBestEffort<{ score: number }>(
    `SELECT score FROM review_scores
     WHERE competitor_id = {cid:String} AND source = {source:String}
     ORDER BY recorded_at DESC LIMIT 1`,
    { cid: competitorId, source },
  );
  return rows && rows.length > 0 ? (rows[0]?.score ?? null) : null;
}

// --- Numeric claims (patch-17). Append-only tracking of quantified homepage
//     claims ("15,000 teams", "99.9% uptime"). Best-effort. ---

export interface NumericClaimRow {
  competitor_id: string;
  monitor_id: string;
  pattern: string;
  unit: string;
  context: string;
  value: number;
  raw_text: string;
  observed_at: Date;
}

export async function insertNumericClaims(rows: NumericClaimRow[]): Promise<void> {
  if (rows.length === 0) return;
  await insertBestEffort("numeric_claims", rows);
}

// --- Tech stack history (patch-18). Append-only appearance/disappearance
//     timeline; Postgres tech_stack_entries holds the present state. Best-effort. ---

export interface TechStackHistoryRow {
  competitor_id: string;
  tech_id: string;
  event: "appeared" | "disappeared";
  importance: string;
  recorded_at: Date;
}

export async function insertTechStackHistory(rows: TechStackHistoryRow[]): Promise<void> {
  if (rows.length === 0) return;
  await insertBestEffort("tech_stack_history", rows);
}

export interface LastNumericClaim {
  pattern: string;
  unit: string;
  context: string;
  value: number;
}

// Latest value per (pattern, unit, context) for a competitor. Called BEFORE
// inserting the current scrape's claims, so it reflects the prior observation.
export async function getLastNumericClaims(
  competitorId: string,
): Promise<LastNumericClaim[] | null> {
  return queryBestEffort<LastNumericClaim>(
    `SELECT pattern, unit, context, argMax(value, observed_at) AS value
     FROM numeric_claims
     WHERE competitor_id = {cid:String}
     GROUP BY pattern, unit, context`,
    { cid: competitorId },
  );
}

// --- Sectoral analysis reads (patch-13). Best-effort: null when CH is down/unset,
//     in which case the pricing/positioning detectors simply produce nothing. ---

export interface PricingHistoryPointRow {
  competitor_id: string;
  plan_name: string;
  price: number;
  recorded_at: string;
}

export async function getPricingHistorySince(
  competitorIds: string[],
  days: number,
): Promise<PricingHistoryPointRow[] | null> {
  if (competitorIds.length === 0) return [];
  return queryBestEffort<PricingHistoryPointRow>(
    `SELECT competitor_id, plan_name, price, recorded_at
     FROM pricing_history
     WHERE competitor_id IN {ids:Array(String)}
       AND price > 0
       AND recorded_at >= now() - toIntervalDay({days:UInt32})
     ORDER BY recorded_at ASC`,
    { ids: competitorIds, days },
  );
}

export interface PricingStatusPointRow {
  competitor_id: string;
  status: string;
  recorded_at: string;
}

export async function getPricingStatusHistorySince(
  competitorIds: string[],
  days: number,
): Promise<PricingStatusPointRow[] | null> {
  if (competitorIds.length === 0) return [];
  return queryBestEffort<PricingStatusPointRow>(
    `SELECT competitor_id, status, recorded_at
     FROM pricing_history
     WHERE competitor_id IN {ids:Array(String)}
       AND status != ''
       AND recorded_at >= now() - toIntervalDay({days:UInt32})
     ORDER BY recorded_at ASC`,
    { ids: competitorIds, days },
  );
}
