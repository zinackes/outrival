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
// Legacy fallback only — superseded by the real token-based cost below for any run
// logged after token attribution shipped (ai_runs.total_tokens > 0).
const USD_PER_AI_CALL = 0.0012;

// Per-model USD per 1M tokens (input / output), 2026 list prices. Trends, not
// accounting — tune as invoices land. Keyed by substring so provider prefixes don't
// matter. Default = llama-3.3-70b (the current pool default).
function aiRateUsdPerM(model: string): { in: number; out: number } {
  const m = model.toLowerCase();
  if (m.includes("gpt-oss")) return { in: 0.15, out: 0.6 };
  if (m.includes("8b")) return { in: 0.05, out: 0.08 }; // llama-3.1-8b-instant (fast tier)
  if (m.includes("claude")) return { in: 3, out: 15 }; // sonnet fallback (rare)
  return { in: 0.59, out: 0.79 }; // llama-3.3-70b default
}

function tokenCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const r = aiRateUsdPerM(model);
  return (promptTokens / 1e6) * r.in + (completionTokens / 1e6) * r.out;
}

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

  // Real token cost per (task, model) over 30d — the actual budget breakdown.
  // total_tokens is 0 for runs logged before token attribution shipped, so these
  // figures only cover runs since; they fill in as new data accumulates.
  const aiTaskRows = await analyticsQuery<{
    task: string;
    model: string;
    calls_30d: string;
    prompt_30d: string;
    completion_30d: string;
    tokens_30d: string;
    prompt_24h: string;
    completion_24h: string;
    tokens_24h: string;
  }>(sql`
    SELECT task, model,
           count(*) AS calls_30d,
           coalesce(sum(prompt_tokens), 0) AS prompt_30d,
           coalesce(sum(completion_tokens), 0) AS completion_30d,
           coalesce(sum(total_tokens), 0) AS tokens_30d,
           coalesce(sum(prompt_tokens) filter (where recorded_at >= now() - make_interval(hours => 24)), 0) AS prompt_24h,
           coalesce(sum(completion_tokens) filter (where recorded_at >= now() - make_interval(hours => 24)), 0) AS completion_24h,
           coalesce(sum(total_tokens) filter (where recorded_at >= now() - make_interval(hours => 24)), 0) AS tokens_24h
    FROM ai_runs
    WHERE recorded_at >= now() - make_interval(days => 30)
    GROUP BY task, model
  `);

  // Aggregate (task, model) rows up to per-task totals + grand totals, applying the
  // per-model rate. A task that runs on multiple models (fast 8b vs smart 70b, or a
  // failover) sums correctly across them.
  const byTask = new Map<
    string,
    { calls30d: number; tokens30d: number; estUsd30d: number; estUsd24h: number }
  >();
  let tokens24h = 0;
  let tokens30d = 0;
  let aiEstUsd24h = 0;
  let aiEstUsd30d = 0;
  for (const r of aiTaskRows) {
    const cost30d = tokenCostUsd(r.model, num(r.prompt_30d), num(r.completion_30d));
    const cost24h = tokenCostUsd(r.model, num(r.prompt_24h), num(r.completion_24h));
    tokens24h += num(r.tokens_24h);
    tokens30d += num(r.tokens_30d);
    aiEstUsd24h += cost24h;
    aiEstUsd30d += cost30d;
    const cur = byTask.get(r.task) ?? { calls30d: 0, tokens30d: 0, estUsd30d: 0, estUsd24h: 0 };
    cur.calls30d += num(r.calls_30d);
    cur.tokens30d += num(r.tokens_30d);
    cur.estUsd30d += cost30d;
    cur.estUsd24h += cost24h;
    byTask.set(r.task, cur);
  }
  const aiByTask = [...byTask.entries()]
    .map(([task, v]) => ({ task, ...v }))
    .sort((a, b) => b.estUsd30d - a.estUsd30d);

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
      // Legacy flat-per-call estimate (kept for back-compat; over-counts cache hits).
      estUsd24h: ai24h * USD_PER_AI_CALL,
      estUsd30d: ai30d * USD_PER_AI_CALL,
      // Real token-based cost (since token attribution shipped).
      tokens24h,
      tokens30d,
      estUsdReal24h: aiEstUsd24h,
      estUsdReal30d: aiEstUsd30d,
    },
    aiByTask,
    storage: {
      postgresBytes, // analytics now live in the same Postgres database
      r2Bytes: null, // not measured (no cheap usage API) — tracked separately
    },
  });
});
