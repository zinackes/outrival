import { createClient } from "@clickhouse/client";

const DATABASE = "outrival";

export async function ensureClickhouseTables(): Promise<void> {
  const url = process.env.CLICKHOUSE_URL;
  if (!url) {
    throw new Error("CLICKHOUSE_URL is required");
  }

  // Bootstrap against `default`: the target database may not exist yet, and
  // ClickHouse rejects every query (even `SELECT 1`) whose connection database
  // is missing (UNKNOWN_DATABASE). So create `outrival` from a connection bound
  // to the always-present `default`, then qualify every DDL with the db name.
  const ch = createClient({
    url,
    password: process.env.CLICKHOUSE_PASSWORD,
    database: "default",
  });

  try {
    await ch.command({ query: `CREATE DATABASE IF NOT EXISTS ${DATABASE}` });

    await ch.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${DATABASE}.pricing_history (
          competitor_id String,
          plan_name String,
          price Float64,
          currency String,
          billing_period String,
          status String DEFAULT 'unknown',
          promotional UInt8 DEFAULT 0,
          observed_region String DEFAULT 'FR',
          recorded_at DateTime DEFAULT now()
        ) ENGINE = MergeTree() ORDER BY (competitor_id, recorded_at)
      `,
    });

    // Backfill the taxonomy columns on pre-patch-11 deployments where
    // pricing_history was created before these columns existed.
    for (const col of [
      "status String DEFAULT 'unknown'",
      "promotional UInt8 DEFAULT 0",
      "observed_region String DEFAULT 'FR'",
    ]) {
      await ch.command({
        query: `ALTER TABLE ${DATABASE}.pricing_history ADD COLUMN IF NOT EXISTS ${col}`,
      });
    }

    await ch.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${DATABASE}.job_counts (
          competitor_id String,
          department String,
          count UInt32,
          recorded_at DateTime DEFAULT now()
        ) ENGINE = MergeTree() ORDER BY (competitor_id, recorded_at)
      `,
    });

    await ch.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${DATABASE}.review_scores (
          competitor_id String,
          source String,
          score Float64,
          review_count UInt32,
          sentiment_score Float64,
          recorded_at DateTime DEFAULT now()
        ) ENGINE = MergeTree() ORDER BY (competitor_id, recorded_at)
      `,
    });

    await ch.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${DATABASE}.signal_feed (
          org_id String,
          competitor_id String,
          category String,
          severity String,
          recorded_at DateTime DEFAULT now()
        ) ENGINE = MergeTree() ORDER BY (org_id, recorded_at)
      `,
    });
  } finally {
    await ch.close();
  }
}
