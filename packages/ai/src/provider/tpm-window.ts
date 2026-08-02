// Per-minute pacing arithmetic for the provider pool (extracted so it can be
// tested without Redis).
//
// The pool already tracked a provider's DAILY token quota, which is the limit that
// never actually bound us. Every free tier also caps tokens PER MINUTE (Cerebras
// ~30k, Groq 8k for gpt-oss-120b), and that is the one the hourly fan-out walks
// into: measured on prod 2026-07-31, Cerebras served 420k tokens in the 05:00 hour
// and then vanished for the rest of the day, while Groq answered 169 calls in that
// same hour and failed 152 of them. Nothing in the pool knew a per-minute ceiling
// existed, so the first burst 429'd the healthy provider, parked it for up to two
// minutes, and dumped everything onto the one provider least able to take it.
//
// The window is the standard two-bucket approximation: the current minute plus the
// share of the previous minute that has not yet aged out. Exact enough to pace
// against, and it costs one mget rather than a sorted set per call.

export const WINDOW_MS = 60_000;

/**
 * Tokens counted as spent in the last `WINDOW_MS`, from the current and previous
 * minute buckets. `elapsedMs` is how far into the current minute we are.
 */
export function slidingWindowTokens(
  previousBucket: number,
  currentBucket: number,
  elapsedMs: number,
  windowMs: number = WINDOW_MS,
): number {
  const carry = Math.min(1, Math.max(0, 1 - elapsedMs / windowMs));
  return Math.round(Math.max(0, previousBucket) * carry + Math.max(0, currentBucket));
}

// What a request costs against this window is NOT computed here. provider-pool's
// `estimateRequestTokens` already derives it for the per-request SIZE filter, from
// the same characters and the same output budget, and one estimate serving both
// ceilings is the point: a second copy would drift from it and nothing would say
// which of the two a given decision had used.

export interface HeadroomInput {
  /** Tokens already spent in this provider's window. */
  observed: number;
  /** The provider's per-minute ceiling. 0 or less = unconfigured. */
  limit: number;
  /** What this request will cost. */
  cost: number;
  /** Share of the ceiling that only interactive work may use (0 to 1). */
  reserveFraction: number;
  /** Whether someone is waiting on this call at a screen. */
  interactive: boolean;
}

/**
 * Whether this provider can fund the request right now.
 *
 * An unconfigured limit means no pacing, which is exactly the behaviour that
 * shipped before this: a provider we have no ceiling for is never skipped.
 *
 * Background work is held to a lower ceiling than interactive work, so a click has
 * budget the hourly fan-out cannot have already eaten. That reserve is the whole
 * reason a solo tester saw "AI insights are delayed" while nothing was wrong: the
 * background fleet and the person watching the screen drew from the same pot, and
 * the fleet is always first.
 */
export function hasHeadroom(input: HeadroomInput): boolean {
  if (input.limit <= 0) return true;
  const reserve = Math.min(1, Math.max(0, input.reserveFraction));
  const ceiling = input.interactive ? input.limit : Math.floor(input.limit * (1 - reserve));
  return input.observed + input.cost <= ceiling;
}
