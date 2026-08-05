// One anti-regression guard for every "the fresh extraction collapsed" case
// (Véracité Intelligence v2, P1 — audit R4/R5).
//
// The same shape was re-derived three times as each intelligence block shipped:
// pricing's coverage guard (a 5-tier page mis-parsed into 1 plan shadows the real
// tiers, because reads take the newest batch), the entitlement anti-collapse (a
// flaky accordion reads as "they un-gated everything"), and the jobs partial-close
// rule (a truncated list closes the postings it never saw). All three answer one
// question: is this count so far below the prior count that it is better explained
// by our extraction failing than by the competitor changing?
//
// Extracted here so the answer is given once. The callers keep their own EVIDENCE
// — pricing corroborates with an AI-free harvest of the page, jobs requires an
// authoritative board list — because what makes a collapse believable is
// source-specific. Only the arithmetic is shared.

export interface RegressionGuardInput {
  /** Count in the prior (trusted, already-stored) state. */
  prevCount: number;
  /** Count the fresh extraction proposes. */
  nextCount: number;
  /**
   * The prior count below which nothing is protected. A guard with no floor
   * would treat 1 → 0 as a collapse, which is exactly how a real "they removed
   * their last tier" move gets suppressed. Each caller sets the floor at the
   * size where a drop stops being plausible for its source.
   */
  minPrev: number;
  /**
   * The smallest count a healthy extraction may still return. Below it, the
   * result is treated as a failed extraction rather than a real change.
   */
  minKeep: number;
}

/**
 * True when the fresh count must NOT overwrite the prior one.
 *
 * Deliberately not "isSuspicious": the return value is an instruction to protect
 * what is already stored, which is the only safe default when the two readings
 * disagree — the prior batch was corroborated by a scrape that worked.
 */
export function protectRegression(input: RegressionGuardInput): boolean {
  const { prevCount, nextCount, minPrev, minKeep } = input;
  return prevCount >= minPrev && nextCount < minKeep;
}

/**
 * `minKeep` for a guard expressed as a fraction of the prior count rather than
 * an absolute floor — "keep at least 30% of what was there". Kept next to the
 * guard so a caller never has to decide how to round it.
 */
export function keepRatio(prevCount: number, ratio: number): number {
  return prevCount * ratio;
}
