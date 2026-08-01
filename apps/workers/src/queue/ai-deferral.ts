import { AIUnavailableError } from "@outrival/ai";

/**
 * How long a job waits after the AI pool refused it, before the queue runs it again.
 *
 * The queue's retry policy is 1s backing off to at most 10s, which is right for a
 * transient fault and exactly wrong for a rate limit: the free tiers answer a 429
 * asking for 18 to 60 seconds, so all three attempts land inside the window that is
 * still throttled, and the job fails having spent two extra rounds of provider calls
 * to learn nothing. Measured on prod over 7 days: 333 extract_pricing AI calls for
 * 184 pricing pages that had actually changed.
 */
const BASE_SEC = Number(process.env.AI_DEFER_BASE_SEC ?? 75);

/**
 * Spread, as a fraction of the base. Without it every job the same outage deferred
 * comes back at the same instant and rebuilds the burst that caused the outage, one
 * window later. The spread is one-sided (never earlier than the base) because coming
 * back early is the one outcome that cannot help.
 */
const JITTER_FRACTION = Number(process.env.AI_DEFER_JITTER_FRACTION ?? 0.4);

/**
 * Queue-level classifier (see startQueue's `deferralResolver`). Only the pool being
 * unavailable defers: every other failure keeps the normal retry policy, because a
 * fault we have not identified is one we want retried promptly and dead-lettered if
 * it persists.
 *
 * AIUnavailableError is the pool's own "every provider refused this", so a deferral
 * cannot fire on a task that merely wrote bad JSON or hit a bug.
 */
export function resolveAiDeferral(err: unknown): number | null {
  if (!(err instanceof AIUnavailableError)) return null;
  // A misconfigured pool does not heal by waiting — an env mistake is still an env
  // mistake in 75 seconds — so it goes to the retry policy and then to the
  // dead-letter queue, where it is visible, instead of being quietly rescheduled.
  if (err.message.startsWith("ai_provider_misconfigured")) return null;
  // Likewise a request no provider would accept: it is the same size next time.
  if (err.message.startsWith("ai_request_too_large")) return null;
  return Math.round(BASE_SEC * (1 + Math.random() * Math.max(0, JITTER_FRACTION)));
}
