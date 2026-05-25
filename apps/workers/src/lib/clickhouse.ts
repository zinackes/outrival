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

export interface SignalFeedRow {
  org_id: string;
  competitor_id: string;
  category: string;
  severity: string;
  recorded_at: Date;
}

export async function insertSignalFeed(row: SignalFeedRow): Promise<void> {
  const ch = getClient();
  if (!ch) {
    logger.warn("ClickHouse not configured, skipping signal_feed insert");
    return;
  }
  try {
    await ch.insert({
      table: "signal_feed",
      values: [row],
      format: "JSONEachRow",
    });
  } catch (err) {
    logger.error("ClickHouse insert failed", { err: String(err) });
  }
}
