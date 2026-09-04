import { AIUnavailableError } from "./circuit-breaker";

/**
 * WHY an AI call failed, in one queryable token (C1 of the AI pool reliability audit).
 *
 * `ai_runs` carried 295-491 error rows a day with no reason attached, so "why is AI
 * failing" was never a question the table could answer — every diagnosis went through
 * worker logs by hand, and the audit itself had to reconstruct the cascade from
 * timestamps. The pool already decides the reason at each throw site and encodes it in
 * the `AIUnavailableError` message prefix; this reads it back rather than re-deriving
 * it, so the label and the message can never disagree.
 *
 * The set is C1's six plus two the code actually throws and that are worth telling
 * apart:
 *   - `no_providers` — every provider was already parked, so the call never reached
 *     one. A pool that is merely saturated looks nothing like a pool that is broken,
 *     and folding this into `rate_limited` would assert a cause we did not observe.
 *   - `breaker_open` — the GLOBAL breaker refused the call. These rows are the
 *     consequence of an earlier storm, not evidence of a new one; counting them as
 *     failures is what made the `:05-:14` window look like its own outage.
 */
export const AI_ERROR_KINDS = [
  "misconfigured",
  "out_of_credit",
  "too_large",
  "empty_replies",
  "rate_limited",
  "no_providers",
  "breaker_open",
  "transient",
] as const;
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number];

// A 429 arrives as the last provider's own words, which differ per vendor: Groq puts
// the wait in prose ("Please try again in 5.91s"), Cloudflare and Mistral send the
// status alone. Match the status number and the two spellings every one of them uses.
const RATE_LIMITED = /\b429\b|rate[\s_-]?limit|too many requests|quota exceeded/i;

/**
 * Classify a throw from the provider pool. Returns `""` for anything that is not an
 * `AIUnavailableError` — a task's own bug, a Zod failure, a network error raised
 * outside the pool — because labelling those would put a pool diagnosis on a row the
 * pool never touched.
 */
export function aiErrorKind(err: unknown): AiErrorKind | "" {
  if (!(err instanceof AIUnavailableError)) return "";
  const msg = err.message;
  if (msg.startsWith("ai_provider_misconfigured")) return "misconfigured";
  if (msg.startsWith("ai_out_of_credit")) return "out_of_credit";
  if (msg.startsWith("ai_request_too_large")) return "too_large";
  if (msg.startsWith("ai_empty_completions")) return "empty_replies";
  if (msg.startsWith("no_providers_available")) return "no_providers";
  // The global breaker rethrows whatever reason tripped it: `too_many_failures`,
  // `too_many_failures:<providerId>`, or the bare `ai_unavailable` fallback. The two
  // reasons that name a real cause (misconfigured, out_of_credit) are matched above
  // and keep that cause even when they arrive via the breaker.
  if (msg.startsWith("too_many_failures") || msg.startsWith("ai_unavailable")) {
    return "breaker_open";
  }
  // `all_providers_failed: <the last provider's error>` — the only branch where the
  // kind is not in the prefix.
  if (RATE_LIMITED.test(msg)) return "rate_limited";
  return "transient";
}
