// Whether the AI self-heal is allowed to spend a call on a (domain, sourceType)
// right now (extracted from staged-extract.ts so it can be tested).
//
// A heal attempt fails for two unrelated reasons, and conflating them is what made
// `generate_extractor` the single largest AI consumer in the product: 42% of all
// tokens over 14 days on production, for 45 usable parsers out of 656 calls.
//
//   - We SAW the page and could not turn it into a parser: the model returned a
//     spec that did not replay, or returned nothing parseable at all. That is a
//     fact about the PAGE. It parks that page for the full cooldown, and the source
//     rides the `ai_fallback` floor until the cooldown lapses. This is the case the
//     cooldown was written for and it already worked.
//
//   - We never reached a provider: every pool member was rate-limited, or the
//     global breaker was open. That says NOTHING about the page, so stamping the
//     page's cooldown would record something we never learned. It is also
//     self-defeating: the pool is most saturated exactly when the hourly fan-out
//     runs, which is when most scrapes happen, so every page captured during a
//     burst would earn a 12h heal ban and the heal path would starve permanently.
//     Measured before this fix, over 14 days: 405 of 656 `generate_extractor` calls
//     never got an answer, only 45 heals ever succeeded against 218 cached
//     extractors, and 181 of 410 runs over 7 days landed within FIVE MINUTES of the
//     previous run for the same competitor. The cooldown never armed on that path
//     at all, because the `catch` swallowed the error without writing anything.
//
// So a pool failure pauses heals PROCESS-WIDE for a short window instead. When the
// pool cannot answer, no page's heal can succeed, so there is nothing to gain by
// asking again on behalf of any of them; and when it recovers, every page is
// immediately eligible again rather than serving out a ban it did not earn.

export interface HealAttemptInput {
  /** When this (domain, sourceType) last had a heal attempt REACH a provider. */
  lastHealAttemptAt: Date | null;
  /** Epoch ms. */
  now: number;
  /** How long a page stays parked after a heal that reached a provider and failed. */
  cooldownMs: number;
  /** Epoch ms until which every heal in this process is paused (0 = not paused). */
  poolPausedUntil: number;
}

export function shouldAttemptHeal(input: HealAttemptInput): boolean {
  // The pool brake wins: a page that is otherwise eligible still cannot be healed
  // by a provider that will not answer.
  if (input.now < input.poolPausedUntil) return false;
  if (input.lastHealAttemptAt == null) return true;
  return input.now - input.lastHealAttemptAt.getTime() >= input.cooldownMs;
}

// --- Process-wide pool pause -------------------------------------------------
//
// Deliberately in-memory rather than in Redis: it is a courtesy backoff, not a
// correctness guarantee. A second worker learning about the outage one call later
// costs one call; depending on Upstash for it would make the brake silently inert
// wherever Redis is absent, which is the failure mode this whole fix is about.

let poolPausedUntil = 0;

export function healPausedUntil(): number {
  return poolPausedUntil;
}

/** Extends the pause; never shortens one already further out. */
export function pauseHealsAfterPoolFailure(now: number, pauseMs: number): void {
  poolPausedUntil = Math.max(poolPausedUntil, now + pauseMs);
}

/** Test seam — the pause is module state shared by every caller in the process. */
export function resetHealPause(): void {
  poolPausedUntil = 0;
}
