import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { logger } from "@trigger.dev/sdk/v3";

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
