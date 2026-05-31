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
    });
  }
  return client;
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
