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

    // Ops observability (patch-02, extended patch-20). Append-only run logs
    // powering the /admin health dashboard: scraping reliability, cascade-level
    // distribution (proxy cost), failure reasons, and AI parse quality.
    await ch.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${DATABASE}.scrape_runs (
          monitor_id String,
          competitor_id String,
          source_type String,
          status String,            -- success | no_change | failed
          level UInt8 DEFAULT 0,    -- patch-20 cascade level: 0/1 free, 2/3/4 paid
          attempts UInt8 DEFAULT 1,
          failure_reason String DEFAULT '',
          duration_ms UInt32,
          recorded_at DateTime DEFAULT now()
        ) ENGINE = MergeTree() ORDER BY (recorded_at)
      `,
    });

    // Patch-20: migrate pre-existing scrape_runs from the boolean used_proxy model
    // to the cascade-level model. Add the new columns, then drop the old ones
    // (used_scrapingbee never existed in this codebase — DROP IF EXISTS is a no-op).
    for (const col of [
      "level UInt8 DEFAULT 0",
      "attempts UInt8 DEFAULT 1",
      "failure_reason String DEFAULT ''",
    ]) {
      await ch.command({
        query: `ALTER TABLE ${DATABASE}.scrape_runs ADD COLUMN IF NOT EXISTS ${col}`,
      });
    }
    for (const col of ["used_proxy", "used_scrapingbee"]) {
      await ch.command({
        query: `ALTER TABLE ${DATABASE}.scrape_runs DROP COLUMN IF EXISTS ${col}`,
      });
    }

    await ch.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${DATABASE}.ai_runs (
          task String,             -- classify | insight | digest | analyze_product | score_overlap | battle_card
          provider String,         -- groq | claude
          model String,
          status String,           -- success | parse_failed | error
          confidence String DEFAULT '',     -- low | medium | high | '' (patch-24)
          self_check_passed Int8 DEFAULT -1, -- -1 not run | 0 failed | 1 passed (patch-24)
          grounding_score Float64 DEFAULT -1, -- ratio of valid citations, -1 = ungrounded (patch-24)
          recorded_at DateTime DEFAULT now()
        ) ENGINE = MergeTree() ORDER BY (recorded_at)
      `,
    });

    // Backfill the anti-hallucination metric columns (patch-24) on deployments
    // where ai_runs was created before they existed.
    for (const col of [
      "confidence String DEFAULT ''",
      "self_check_passed Int8 DEFAULT -1",
      "grounding_score Float64 DEFAULT -1",
    ]) {
      await ch.command({
        query: `ALTER TABLE ${DATABASE}.ai_runs ADD COLUMN IF NOT EXISTS ${col}`,
      });
    }

    // Quantified homepage claims tracked over time (patch-17): "15,000 teams",
    // "99.9% uptime". Append-only; the worker reads the last value per
    // (competitor, pattern, unit, context) to detect a significant variation.
    await ch.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${DATABASE}.numeric_claims (
          competitor_id String,
          monitor_id String,
          pattern String,          -- user_count | uptime | scale | satisfaction | savings | other_metric
          unit String,
          context String,
          value Float64,
          raw_text String,
          observed_at DateTime DEFAULT now()
        ) ENGINE = MergeTree() ORDER BY (competitor_id, pattern, observed_at)
      `,
    });

    // Tech-stack appearance/disappearance timeline (patch-18). Append-only;
    // Postgres tech_stack_entries holds the present state, this holds the history.
    await ch.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${DATABASE}.tech_stack_history (
          competitor_id String,
          tech_id String,
          event String,            -- appeared | disappeared
          importance String,       -- high | medium | low
          recorded_at DateTime DEFAULT now()
        ) ENGINE = MergeTree() ORDER BY (competitor_id, recorded_at)
      `,
    });
  } finally {
    await ch.close();
  }
}
