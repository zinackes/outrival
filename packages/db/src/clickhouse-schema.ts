import { ch } from "./clickhouse";

export async function ensureClickhouseTables(): Promise<void> {
  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS pricing_history (
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
      query: `ALTER TABLE pricing_history ADD COLUMN IF NOT EXISTS ${col}`,
    });
  }

  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS job_counts (
        competitor_id String,
        department String,
        count UInt32,
        recorded_at DateTime DEFAULT now()
      ) ENGINE = MergeTree() ORDER BY (competitor_id, recorded_at)
    `,
  });

  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS review_scores (
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
      CREATE TABLE IF NOT EXISTS signal_feed (
        org_id String,
        competitor_id String,
        category String,
        severity String,
        recorded_at DateTime DEFAULT now()
      ) ENGINE = MergeTree() ORDER BY (org_id, recorded_at)
    `,
  });
}
