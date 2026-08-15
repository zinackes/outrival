/**
 * A/B oscillation folding — the OTHER half of the flap problem.
 *
 * `ab-test-signal.ts` catches a page that will not reproduce its own delta inside one
 * verification: the capture and the re-capture disagree, so the bucket is visible in a
 * single detection. That machinery is blind to the case where every capture is
 * internally consistent and the page simply serves 5, then 6, then 5 again over days —
 * each reading reproduces perfectly, each becomes its own change, and the customer gets
 * N alerts for one undecided experiment. The JFrog 5 → 6 → 5 signals of 2026-08-13 are
 * exactly that shape.
 *
 * The tell is the same one the flap detector uses, read over the SIGNAL history instead
 * of the verification history: a delta whose exact inverse was already signalled on this
 * page inside the window is not a second decision, it is the first one coming back. Fold
 * it into the signal that is already there and count the flips.
 *
 * Pure and DB-free (the priors are fetched by the job and passed in) so the window, the
 * inverse test and the fold arithmetic are unit-testable without a worker runtime.
 */

import { buildDeltaProof, hasDeltaEvidence, isInverse, type DeltaProof } from "@outrival/shared";

/** Days a signalled delta stays foldable. Same fortnight as the verification flap
 *  window (FLAP_WINDOW_DAYS): a pricing test runs 2-4 weeks, so a fortnight catches
 *  the flips while the test is still running and lets a genuine re-change months
 *  later be its own signal. */
export const OSCILLATION_WINDOW_DAYS = 14;

/** Folded change ids kept on the row. The counter is the finding; the ids are there so
 *  the panel can link the flips, and an unbounded array on a page that flips daily
 *  would grow without ever being read past the first screen. */
export const MAX_FOLDED_CHANGE_IDS = 20;

/** What the feed shows instead of N near-identical cards. */
export interface OscillationRecord {
  /** Distinct captures of this back-and-forth, the original signal included. Starts at
   *  2 on the first fold: the signal itself is one observation, the flip is the second. */
  observations: number;
  /** How the two readings differ, in the words the original signal already used. */
  variantA: string;
  variantB: string;
  /** The folded changes, oldest first, capped. The signal's own change is not here —
   *  it is `signals.changeId`. */
  changeIds: string[];
  /** ISO instant of the most recent flip. */
  lastObservedAt: string;
}

/** The parts of a prior signal + its change this module reads. */
export interface PriorSignalDelta {
  signalId: string;
  changeId: string;
  detectedAt: Date;
  diffText: string | null;
  humanChangeBefore: string | null;
  humanChangeAfter: string | null;
  oscillation: OscillationRecord | null;
}

function windowStart(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/**
 * The signal this change is a flip of, or null.
 *
 * Priors are expected newest-first (the query orders by detectedAt desc) and the first
 * inverse match wins: folding into the most recent signal keeps one live card per
 * running test rather than resurrecting the oldest one every fortnight.
 *
 * A prior with no usable excerpts is skipped rather than treated as a non-match — an
 * empty proof's fingerprint is a constant, and two empty proofs are each other's
 * inverse, which would fold every evidence-free change into the last evidence-free one.
 */
export function findOscillation(
  proof: DeltaProof,
  priors: readonly PriorSignalDelta[],
  now: Date = new Date(),
): PriorSignalDelta | null {
  if (!hasDeltaEvidence(proof)) return null;
  const cutoff = windowStart(now, OSCILLATION_WINDOW_DAYS);
  for (const prior of priors) {
    if (prior.detectedAt < cutoff) continue;
    const priorProof = buildDeltaProof(prior);
    if (!hasDeltaEvidence(priorProof)) continue;
    if (isInverse(priorProof.fingerprint, proof)) return prior;
  }
  return null;
}

/**
 * How the two readings read, for the card. The prior signal's typed human_change pair
 * is preferred: it is the sentence a human already approved ("Standard · $99/mo"),
 * where the excerpts are normalised lowercase diff lines. Falls back to the excerpts so
 * a lexical change with no typed pair still names its variants.
 */
function variantsOf(prior: PriorSignalDelta): { a: string; b: string } | null {
  if (prior.humanChangeBefore && prior.humanChangeAfter) {
    return { a: prior.humanChangeBefore, b: prior.humanChangeAfter };
  }
  const proof = buildDeltaProof(prior);
  const a = proof.removedExcerpts[0];
  const b = proof.addedExcerpts[0];
  if (!a || !b) return null;
  return { a, b };
}

/**
 * The record to write back on the prior signal after folding one flip into it.
 *
 * Re-folding an already-folded signal keeps its variants: the pair names the axis the
 * page is testing, and a later flip is another observation of that same axis, not a new
 * one. Duplicate change ids are ignored so a retried job cannot inflate the count —
 * the counter is the finding, and a finding that drifts on retry is worse than none.
 */
export function foldOscillation(
  prior: PriorSignalDelta,
  changeId: string,
  now: Date = new Date(),
): OscillationRecord | null {
  const existing = prior.oscillation;
  if (existing?.changeIds.includes(changeId)) return null;

  const variants = existing
    ? { a: existing.variantA, b: existing.variantB }
    : variantsOf(prior);
  if (!variants) return null;

  const changeIds = [...(existing?.changeIds ?? []), changeId].slice(-MAX_FOLDED_CHANGE_IDS);
  return {
    // The signal's own change is the first observation, so the count is the folded
    // flips plus one — not changeIds.length, which the cap above can truncate.
    observations: (existing?.observations ?? 1) + 1,
    variantA: variants.a,
    variantB: variants.b,
    changeIds,
    lastObservedAt: now.toISOString(),
  };
}
