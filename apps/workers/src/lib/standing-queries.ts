// Standing queries — pure decision helpers for the evaluate-standing-queries job.
// Kept DB-free so the trigger targeting (a), reformulation-vs-set-change (b) and
// hysteresis (c) guarantees are unit-testable without a worker runtime.

export type SignalSeverity = "low" | "medium" | "high" | "critical";

const SEVERITY_RANK: Record<SignalSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export interface TriggeringSignal {
  competitorId: string;
  category: string;
  severity: SignalSeverity;
}

export interface MatchableStandingQuery {
  isActive: boolean;
  /** Empty = wildcard (any competitor of the org). */
  watchedCompetitorIds: string[];
  /** Empty = wildcard (any category). */
  watchedCategories: string[];
  minSeverity: SignalSeverity;
  cooldownHours: number;
  lastEvaluatedAt: Date | null;
}

/**
 * TARGETED trigger: a standing query is re-evaluated only when the new signal
 * touches the entities it mentions (extracted once at creation), clears the
 * query's materiality floor, and the cooldown window has elapsed.
 */
export function matchesStandingQuery(
  signal: TriggeringSignal,
  query: MatchableStandingQuery,
  now: Date = new Date(),
): boolean {
  if (!query.isActive) return false;
  if (SEVERITY_RANK[signal.severity] < SEVERITY_RANK[query.minSeverity]) return false;
  if (
    query.watchedCompetitorIds.length > 0 &&
    !query.watchedCompetitorIds.includes(signal.competitorId)
  ) {
    return false;
  }
  if (
    query.watchedCategories.length > 0 &&
    !query.watchedCategories.includes(signal.category)
  ) {
    return false;
  }
  if (
    query.lastEvaluatedAt !== null &&
    now.getTime() - query.lastEvaluatedAt.getTime() < query.cooldownHours * 3_600_000
  ) {
    return false;
  }
  return true;
}

/**
 * Hysteresis: alert only when a material change persists 2 consecutive
 * evaluations. One material evaluation arms the counter; the next one (still
 * material vs the SAME baseline) alerts and the caller promotes the fresh answer
 * to baseline. Any non-material evaluation (set back to baseline, or judge says
 * substance unchanged) disarms.
 */
export function nextHysteresisState(
  pendingCount: number,
  material: boolean,
): { pendingCount: number; alert: boolean } {
  if (!material) return { pendingCount: 0, alert: false };
  if (pendingCount >= 1) return { pendingCount: 0, alert: true };
  return { pendingCount: 1, alert: false };
}
