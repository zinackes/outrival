// Standing queries — pure decision helpers for the evaluate-standing-queries job.
// Kept DB-free (judge + insight lookup injected) so the trigger targeting (a),
// reformulation-vs-set-change (b) and hysteresis (c) guarantees are unit-testable
// without a worker runtime.

import type { StandingQueryJudgeInput, StandingQueryJudgement } from "@outrival/ai";
import { normalizeSignalIdSet, signalSetsEqual } from "@outrival/shared";

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

export interface FreshAskAnswer {
  answer: string;
  citations: Array<{ type: "competitor" | "signal"; id: string; label: string }>;
}

export interface EvaluableStandingQuery {
  orgId: string;
  question: string;
  currentAnswer: string;
  currentSignalIds: string[];
  pendingCount: number;
}

export type EvaluationOutcome =
  // Same cited-signal set → same substance by construction. The judge is NEVER
  // consulted: a reformulated answer cannot alert. Disarms the counter.
  | { action: "no_change" }
  // Judge unavailable (transient AI failure): stamp the evaluation, keep the
  // hysteresis counter — neither reset nor advance on missing evidence.
  | { action: "judge_unavailable" }
  // Judged, not alerting: pendingCount 0 = immaterial (evidence rotation),
  // pendingCount 1 = material once, armed — the next material eval alerts.
  | { action: "pending"; pendingCount: number }
  // Material change persisted 2 evaluations → alert + promote fresh to baseline.
  | { action: "alert"; changeSummary: string };

export interface EvaluationDeps {
  judge: (input: StandingQueryJudgeInput) => Promise<StandingQueryJudgement | null>;
  /** Resolve signal ids to their insight texts (org-scoped in the real impl). */
  fetchInsights: (orgId: string, ids: string[]) => Promise<string[]>;
}

/**
 * Core of one standing-query evaluation, DB-free: compare the cited-signal SETS
 * (never the answer text), consult the judge only when they differ, and run the
 * hysteresis. The job maps the outcome to row updates + the alert side effects.
 */
export async function evaluateFreshAnswer(
  query: EvaluableStandingQuery,
  fresh: FreshAskAnswer,
  deps: EvaluationDeps,
): Promise<{ outcome: EvaluationOutcome; freshSignalIds: string[] }> {
  const freshSignalIds = normalizeSignalIdSet(
    fresh.citations.filter((c) => c.type === "signal").map((c) => c.id),
  );

  if (signalSetsEqual(query.currentSignalIds, freshSignalIds)) {
    return { outcome: { action: "no_change" }, freshSignalIds };
  }

  const currentSet = new Set(query.currentSignalIds);
  const freshSet = new Set(freshSignalIds);
  const addedSignals = await deps.fetchInsights(
    query.orgId,
    freshSignalIds.filter((id) => !currentSet.has(id)),
  );
  const removedSignals = await deps.fetchInsights(
    query.orgId,
    query.currentSignalIds.filter((id) => !freshSet.has(id)),
  );

  const judgement = await deps
    .judge({
      question: query.question,
      baselineAnswer: query.currentAnswer,
      freshAnswer: fresh.answer,
      addedSignals,
      removedSignals,
    })
    .catch(() => null);
  if (!judgement) return { outcome: { action: "judge_unavailable" }, freshSignalIds };

  const { pendingCount, alert } = nextHysteresisState(
    query.pendingCount,
    judgement.materiallyChanged,
  );
  if (alert) {
    return {
      outcome: { action: "alert", changeSummary: judgement.changeSummary },
      freshSignalIds,
    };
  }
  return { outcome: { action: "pending", pendingCount }, freshSignalIds };
}
