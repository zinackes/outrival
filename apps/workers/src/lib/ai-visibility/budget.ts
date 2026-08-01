import { sql } from "drizzle-orm";
import { db } from "@outrival/db";
import { computeHash } from "@outrival/shared";
import { logger } from "../job-logger";
import type { Engine } from "./engines";

// The answer engines' spend ledger (packages/db/src/schema/ai-visibility.ts:
// ai_visibility_engine_budget). Two jobs in one row per (engine, model):
//
//   1. PACING that survives concurrency. The old pacer was a module-level Map read
//      before a sleep and written after it, so N concurrent runs all read the same
//      "last call" and fired together. Measured on prod 2026-08-01: six runs picked
//      up inside six seconds answered 21 of 110 prompts, where the same orgs running
//      alone answer 10 to 14 each. `next_call_allowed_at` is a BOOKED SLOT instead:
//      a caller pushes it forward atomically and gets the slot it just took, so
//      callers queue rather than collide, with no lock and no leader.
//
//   2. A HARD DAILY CEILING in code. The free Gemini tier caps requests per MODEL
//      per project (measured: 20/day, 5/min), and grounding is not the constraint at
//      all (27 used of 1,500). Nothing outside this file may assume the budget; the
//      reservation is the only way to make a call.
//
// The count self-resets: a reservation on a new UTC day overwrites `day` and restarts
// `calls`, so no sweeper is needed.

/** Seconds between two calls to the SAME model. Free tier measured at 5 RPM. */
const MIN_REQUEST_GAP_MS = Number(process.env.AI_VISIBILITY_MIN_REQUEST_GAP_MS ?? 13_000);

/**
 * Requests per model per UTC day. The measured free-tier ceiling is 20; the default
 * sits under it because the project is shared with the owner's own tooling, and
 * because a reservation is spent whether the call succeeds or 429s.
 */
export function modelDailyCap(): number {
  return Number(process.env.AI_VISIBILITY_MODEL_DAILY_BUDGET ?? 15);
}

/**
 * Calls held back for the onboarding teaser. The teaser is three calls at day 0 and
 * an activation moment, so the tracked sweep stops short of the cap and leaves it a
 * slice. The teaser itself reserves against the full cap.
 */
export function teaserReserve(): number {
  return Number(process.env.AI_VISIBILITY_TEASER_RESERVE ?? 3);
}

/**
 * The models an engine may draw on, in declaration order. Gemini's quota bucket is
 * per MODEL, so a second pinned model is a second free allowance on the same key and
 * the same project — the only capacity lever available without a new GCP project.
 *
 * NEVER a `-latest` alias: the grounding allowance is granted per model and an alias
 * drifts onto a generation that has none (outage 13/07 to 24/07/2026).
 */
export function engineModels(engine: Engine): string[] {
  const raw =
    engine === "gemini"
      ? process.env.AI_VISIBILITY_GEMINI_MODELS ??
        process.env.AI_VISIBILITY_GEMINI_MODEL ??
        "gemini-2.5-flash"
      : process.env.AI_VISIBILITY_PERPLEXITY_MODEL ?? "sonar";
  const models = raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return models.length > 0 ? models : ["gemini-2.5-flash"];
}

/**
 * Which model answers a given prompt. Stable by construction: the same prompt keeps
 * the same writer for as long as the model list is unchanged. That matters more than
 * squeezing out an extra answer — two models disagree about whether a brand is named,
 * so letting a prompt overflow onto a sibling bucket would manufacture the exact
 * "share of voice moved" signal this feature exists to detect.
 */
export function pickModel(models: string[], key: string): string {
  const first = models[0] ?? "gemini-2.5-flash";
  if (models.length === 1) return first;
  const bucket = parseInt(computeHash(key).slice(0, 8), 16) % models.length;
  return models[bucket] ?? first;
}

/**
 * Book the next call slot for (engine, model), or refuse when the day's cap is spent.
 *
 * Returns the instant the caller may fire at (already reserved, so no two callers get
 * the same one), or null when the model has nothing left today. A refused reservation
 * is not an error: the drip re-offers that prompt tomorrow, oldest first.
 *
 * Best-effort by design: if the ledger itself is unreachable we fall back to firing
 * now rather than taking the feature down, because an unpaced call costs one 429 and
 * a hard failure costs the run.
 */
export async function reserveEngineCall(
  engine: Engine,
  model: string,
  cap = modelDailyCap(),
): Promise<Date | null> {
  const gapSeconds = MIN_REQUEST_GAP_MS / 1000;
  try {
    const rows = (await db.execute(sql`
      INSERT INTO ai_visibility_engine_budget (engine, model, day, calls, next_call_allowed_at)
      VALUES (
        ${engine}, ${model}, (now() AT TIME ZONE 'utc')::date, 1,
        now() + make_interval(secs => ${gapSeconds})
      )
      ON CONFLICT (engine, model) DO UPDATE SET
        day = (now() AT TIME ZONE 'utc')::date,
        calls = CASE
                  WHEN ai_visibility_engine_budget.day = (now() AT TIME ZONE 'utc')::date
                  THEN ai_visibility_engine_budget.calls + 1
                  ELSE 1
                END,
        next_call_allowed_at =
          greatest(now(), ai_visibility_engine_budget.next_call_allowed_at)
          + make_interval(secs => ${gapSeconds})
      WHERE CASE
              WHEN ai_visibility_engine_budget.day = (now() AT TIME ZONE 'utc')::date
              THEN ai_visibility_engine_budget.calls
              ELSE 0
            END < ${cap}
      RETURNING
        (next_call_allowed_at - make_interval(secs => ${gapSeconds})) AS slot,
        calls
    `)) as unknown as Array<{ slot: string | Date; calls: number }>;

    const row = rows[0];
    if (!row) return null; // cap reached for today
    return row.slot instanceof Date ? row.slot : new Date(row.slot);
  } catch (err) {
    logger.warn("ai-visibility: budget ledger unreachable, firing unpaced", {
      engine,
      model,
      err: String(err),
    });
    return new Date();
  }
}

/**
 * Burn the rest of the day for a model. Called when the provider itself reports a
 * per-day allowance 429: the ledger's count is our model of their quota, and once
 * they contradict it, theirs wins.
 */
export async function markModelExhausted(engine: Engine, model: string): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO ai_visibility_engine_budget (engine, model, day, calls, next_call_allowed_at)
      VALUES (${engine}, ${model}, (now() AT TIME ZONE 'utc')::date, ${modelDailyCap()}, now())
      ON CONFLICT (engine, model) DO UPDATE SET
        day = (now() AT TIME ZONE 'utc')::date,
        calls = ${modelDailyCap()}
    `);
  } catch (err) {
    logger.warn("ai-visibility: could not mark model exhausted", {
      engine,
      model,
      err: String(err),
    });
  }
}

/**
 * How many calls the engine still has today across all its models, minus the slice
 * held for the teaser. This is what the drip scheduler sizes its work against: it
 * enqueues only what it can actually pay for, so a product is never half-checked.
 *
 * Returns 0 on a read error: refusing to schedule is the safe direction, since the
 * scheduler runs again tomorrow.
 */
export async function engineDailyRemaining(engine: Engine, reserve = teaserReserve()): Promise<number> {
  const models = engineModels(engine);
  const cap = modelDailyCap();
  try {
    const rows = (await db.execute(sql`
      SELECT model, calls FROM ai_visibility_engine_budget
      WHERE engine = ${engine} AND day = (now() AT TIME ZONE 'utc')::date
    `)) as unknown as Array<{ model: string; calls: number }>;
    const spent = new Map(rows.map((r) => [r.model, Number(r.calls) || 0]));
    const total = models.reduce((sum, m) => sum + Math.max(0, cap - (spent.get(m) ?? 0)), 0);
    return Math.max(0, total - reserve);
  } catch (err) {
    logger.warn("ai-visibility: could not read remaining budget", { engine, err: String(err) });
    return 0;
  }
}
