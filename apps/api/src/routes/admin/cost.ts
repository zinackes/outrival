import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "@outrival/db";
import { logger } from "@outrival/shared";
import { analyticsQuery } from "../../lib/analytics-safe";
import { num, type AdminVariables } from "./shared";

// --- Cost estimation constants. TRENDS, not accounting. Documented in
//     findings.md § Patch-02/20. Tune as real invoices come in. ---
// Patch-20 proxy model: datacenter is a FIXED monthly cost (flat, bandwidth
// unlimited), residential is pay-per-GB. We don't meter GB, so we surface the
// fixed datacenter line plus a rough per-residential-scrape estimate as a trend.
const DATACENTER_FIXED_USD_PER_MONTH = 10;
const USD_PER_RESIDENTIAL_SCRAPE = 0.05; // ~a few hundred KB/page at ~$4.7/GB
// Groq llama-3.x blended per-call estimate (~1.5k in + ~0.5k out, mixed 8b/70b).
const USD_PER_AI_CALL = 0.0012;

export const costRouter = new Hono<{ Variables: AdminVariables }>();

// --- Cost: trend estimates (NOT accounting), clearly flagged ---
costRouter.get("/cost", async (c) => {
  const proxyRows = await analyticsQuery<{
    paid_24h: string;
    paid_30d: string;
    resi_24h: string;
    resi_30d: string;
  }>(sql`
    SELECT count(*) filter (where level >= 2 AND recorded_at >= now() - make_interval(hours => 24)) AS paid_24h,
           count(*) filter (where level >= 2 AND recorded_at >= now() - make_interval(days => 30)) AS paid_30d,
           count(*) filter (where level >= 3 AND recorded_at >= now() - make_interval(hours => 24)) AS resi_24h,
           count(*) filter (where level >= 3 AND recorded_at >= now() - make_interval(days => 30)) AS resi_30d
    FROM scrape_runs
  `);
  const aiRows = await analyticsQuery<{ ai_24h: string; ai_30d: string }>(sql`
    SELECT count(*) filter (where recorded_at >= now() - make_interval(hours => 24)) AS ai_24h,
           count(*) filter (where recorded_at >= now() - make_interval(days => 30)) AS ai_30d
    FROM ai_runs
  `);

  let postgresBytes: number | null = null;
  try {
    const rows = (await db.execute(
      sql`SELECT pg_database_size(current_database()) AS bytes`,
    )) as unknown as Array<{ bytes: string | number }>;
    postgresBytes = rows[0] ? num(rows[0].bytes) : null;
  } catch (err) {
    logger.error({ err }, "pg_database_size query failed");
  }

  const paid24h = num(proxyRows[0]?.paid_24h);
  const paid30d = num(proxyRows[0]?.paid_30d);
  const resi24h = num(proxyRows[0]?.resi_24h);
  const resi30d = num(proxyRows[0]?.resi_30d);
  const ai24h = num(aiRows[0]?.ai_24h);
  const ai30d = num(aiRows[0]?.ai_30d);

  return c.json({
    estimated: true,
    proxy: {
      // paid (level >= 2) scrapes; residential (>= 3) drives the variable cost.
      scrapes24h: paid24h,
      scrapes30d: paid30d,
      fixedUsdPerMonth: DATACENTER_FIXED_USD_PER_MONTH,
      estUsd24h: DATACENTER_FIXED_USD_PER_MONTH / 30 + resi24h * USD_PER_RESIDENTIAL_SCRAPE,
      estUsd30d: DATACENTER_FIXED_USD_PER_MONTH + resi30d * USD_PER_RESIDENTIAL_SCRAPE,
    },
    ai: {
      calls24h: ai24h,
      calls30d: ai30d,
      estUsd24h: ai24h * USD_PER_AI_CALL,
      estUsd30d: ai30d * USD_PER_AI_CALL,
    },
    storage: {
      postgresBytes, // analytics now live in the same Postgres database
      r2Bytes: null, // not measured (no cheap usage API) — tracked separately
    },
  });
});
