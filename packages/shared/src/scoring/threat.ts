import type { SignalSeverity } from "../constants/sources";

/**
 * Threat score (P0) — how much a signal actually matters to THIS user, not in the
 * absolute. Combines three already-stored axes so the feed surfaces the frontal
 * competitor moving on our turf above the noise of a tangential one:
 *
 *   score = severityWeight × overlapNorm × relevanceNorm   ∈ [0, 1]
 *
 * - severity: the AI classification of the change in the absolute.
 * - overlapScore: `competitors.overlapScore` (0-100, NULLABLE — competitors added
 *   manually are never scored). Null → neutral 0.5 so they aren't zeroed out.
 * - relevanceScore: `signals.relevanceScore` (0-1, NULLABLE — only set for the
 *   structured homepage path). Null → neutral 0.5, same reasoning.
 *
 * PURE and deterministic. The neutral fallbacks matter: without them any signal
 * missing one axis would collapse to 0 and sink to the bottom of the feed.
 */

const SEVERITY_WEIGHT: Record<SignalSeverity, number> = {
  critical: 1,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
};

const NEUTRAL = 0.5;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export interface ThreatInput {
  severity: SignalSeverity;
  /** competitors.overlapScore — 0-100 scale, nullable. */
  overlapScore: number | null;
  /** signals.relevanceScore — 0-1 scale, nullable. */
  relevanceScore: number | null;
}

export function computeThreatScore(input: ThreatInput): number {
  const severityWeight = SEVERITY_WEIGHT[input.severity];
  const overlapNorm =
    input.overlapScore == null ? NEUTRAL : clamp01(input.overlapScore / 100);
  const relevanceNorm =
    input.relevanceScore == null ? NEUTRAL : clamp01(input.relevanceScore);
  return clamp01(severityWeight * overlapNorm * relevanceNorm);
}
