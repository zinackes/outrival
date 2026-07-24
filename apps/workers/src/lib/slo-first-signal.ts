import { logger } from "./job-logger";
import { sql } from "drizzle-orm";
import { db } from "@outrival/db";
import {
  FIRST_SIGNAL_SLO_TARGET as SLO_TARGET,
  FIRST_SIGNAL_WEEK_DEGRADED_BELOW as WEEK_DEGRADED_BELOW,
  FIRST_SIGNAL_WEEK_MIN_SAMPLE as WEEK_MIN_SAMPLE,
  FIRST_SIGNAL_WINDOW_MIN_SAMPLE as WINDOW_MIN_SAMPLE,
  FIRST_SIGNAL_CONSECUTIVE_MISSES as CONSECUTIVE_MISSES,
  type FirstSignalSloInputs,
  type ComplianceWindow,
} from "@outrival/shared";

// First-signal SLO (docs/slos/onboarding-first-signal.md): SLI = share of
// onboarding completions whose org saw its first signal within 10 minutes.
// Low-traffic alerting is EVENT-based (burn rates are meaningless at 1-3
// onboardings/day): 3 consecutive misses page, trailing-window compliance
// tickets. Reads run against the same Neon database (onboarding_sessions ⋈
// signals); evaluation is pure and unit-tested. Thresholds + the FirstSignalSloInputs
// shape are the single source in @outrival/shared, shared with the /admin readout.

export type { FirstSignalSloInputs, ComplianceWindow } from "@outrival/shared";

/**
 * One event per completed onboarding session (the SLO doc's definition — the
 * denominator is unconditional). Only sessions whose 10-minute window has
 * ELAPSED count, so an onboarding finished 2 minutes ago is neither hit nor
 * miss yet. Returns null on any read error — the ops check just skips.
 */
export async function getFirstSignalSloInputs(): Promise<FirstSignalSloInputs | null> {
  try {
    const recentRows = (await db.execute(sql`
      SELECT (fs.first_signal_at IS NOT NULL
              AND fs.first_signal_at <= os.completed_at + interval '10 minutes') AS hit
      FROM onboarding_sessions os
      LEFT JOIN LATERAL (
        SELECT min(s.created_at) AS first_signal_at FROM signals s WHERE s.org_id = os.org_id
      ) fs ON true
      WHERE os.stage = 'completed' AND os.completed_at IS NOT NULL
        AND os.completed_at <= now() - interval '10 minutes'
      ORDER BY os.completed_at DESC
      LIMIT ${CONSECUTIVE_MISSES}
    `)) as unknown as Array<{ hit: boolean }>;

    const aggRows = (await db.execute(sql`
      WITH completions AS (
        SELECT os.org_id, os.completed_at
        FROM onboarding_sessions os
        WHERE os.stage = 'completed' AND os.completed_at IS NOT NULL
          AND os.completed_at >= now() - interval '28 days'
          AND os.completed_at <= now() - interval '10 minutes'
      ),
      fs AS (
        SELECT c.completed_at,
               (SELECT min(s.created_at) FROM signals s WHERE s.org_id = c.org_id) AS first_signal_at
        FROM completions c
      )
      SELECT
        count(*) FILTER (WHERE completed_at >= now() - interval '7 days')::int AS week_n,
        count(*) FILTER (WHERE completed_at >= now() - interval '7 days'
          AND first_signal_at <= completed_at + interval '10 minutes')::int AS week_within,
        count(*)::int AS window_n,
        count(*) FILTER (
          WHERE first_signal_at <= completed_at + interval '10 minutes')::int AS window_within,
        count(*) FILTER (WHERE completed_at <= now() - interval '24 hours')::int AS cov_n,
        count(*) FILTER (WHERE completed_at <= now() - interval '24 hours'
          AND first_signal_at <= completed_at + interval '24 hours')::int AS cov_within
      FROM fs
    `)) as unknown as Array<{
      week_n: number;
      week_within: number;
      window_n: number;
      window_within: number;
      cov_n: number;
      cov_within: number;
    }>;
    const agg = aggRows[0];
    if (!agg) return null;

    return {
      recent: recentRows.map((r) => r.hit === true),
      week: { completions: Number(agg.week_n), within: Number(agg.week_within) },
      window: { completions: Number(agg.window_n), within: Number(agg.window_within) },
      coverage24h: { completions: Number(agg.cov_n), within: Number(agg.cov_within) },
    };
  } catch (err) {
    logger.warn("first-signal SLO read failed", { err: String(err) });
    return null;
  }
}

function pct(w: ComplianceWindow): string {
  return w.completions > 0 ? `${Math.round((w.within / w.completions) * 100)}%` : "n/a";
}

/**
 * The SLO doc's alert table, pure and testable:
 *   3 consecutive misses            → page  (systemic breakage, P ≈ 2.7% at 70%)
 *   7d compliance < 50%, n ≥ 5      → ticket (trending toward exhaustion)
 *   28d compliance < 70%, n ≥ 10    → error-budget policy kicks in
 */
export function evaluateFirstSignalAlerts(i: FirstSignalSloInputs): string[] {
  const alerts: string[] = [];

  if (
    i.recent.length >= CONSECUTIVE_MISSES &&
    i.recent.slice(0, CONSECUTIVE_MISSES).every((hit) => !hit)
  ) {
    alerts.push(
      `🚨 First-signal SLO: the last ${CONSECUTIVE_MISSES} onboardings ALL missed the 10-min mark — ` +
        `check backfill_runs outcomes (Wayback down? classify wedged? first scrape failing?)`,
    );
  }

  if (
    i.week.completions >= WEEK_MIN_SAMPLE &&
    i.week.within / i.week.completions < WEEK_DEGRADED_BELOW
  ) {
    alerts.push(
      `⚠️ First-signal SLO degrading: 7d compliance ${pct(i.week)} ` +
        `(${i.week.within}/${i.week.completions}, target 70%)`,
    );
  }

  if (
    i.window.completions >= WINDOW_MIN_SAMPLE &&
    i.window.within / i.window.completions < SLO_TARGET
  ) {
    alerts.push(
      `📉 First-signal SLO budget exhausted: 28d compliance ${pct(i.window)} ` +
        `(${i.window.within}/${i.window.completions}) < 70% — ` +
        `error-budget policy applies (docs/slos/onboarding-first-signal.md)`,
    );
  }

  return alerts;
}
