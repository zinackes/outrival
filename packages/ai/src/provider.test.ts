import { test, expect } from "bun:test";
import OpenAI from "openai";
import {
  resolveReasoningEffort,
  isConfigError,
  isOutOfCredit,
  isTooLarge,
  rateLimitBackoffSec,
  classifyExhaustion,
  shouldFailover,
} from "./provider";
import {
  estimateRequestTokens,
  providersAcceptingSize,
  type Provider,
} from "./provider/provider-pool";

test("non-reasoning models (Llama) never receive reasoning_effort", () => {
  expect(resolveReasoningEffort("llama-3.3-70b-versatile")).toBeUndefined();
  expect(resolveReasoningEffort("llama-3.1-8b-instant")).toBeUndefined();
});

test("a Llama provider override is still ignored (param would break/has no effect)", () => {
  expect(resolveReasoningEffort("llama-3.3-70b-versatile", "medium")).toBeUndefined();
});

test("gpt-oss models default to low (validated cheapest, equal quality)", () => {
  expect(resolveReasoningEffort("openai/gpt-oss-120b")).toBe("low");
  expect(resolveReasoningEffort("openai/gpt-oss-20b")).toBe("low");
});

test("gpt-oss respects an explicit provider override", () => {
  expect(resolveReasoningEffort("openai/gpt-oss-120b", "medium")).toBe("medium");
  expect(resolveReasoningEffort("openai/gpt-oss-120b", "high")).toBe("high");
});

test("detection is case-insensitive", () => {
  expect(resolveReasoningEffort("OpenAI/GPT-OSS-120B")).toBe("low");
});

const apiError = (status: number) =>
  new OpenAI.APIError(status, undefined, `${status} status code (no body)`, undefined);

test("config errors (bad key / wrong model / wrong base URL) are 401/403/404", () => {
  expect(isConfigError(apiError(401))).toBe(true);
  expect(isConfigError(apiError(403))).toBe(true);
  expect(isConfigError(apiError(404))).toBe(true);
});

test("transient faults (rate limit, 5xx) are NOT config errors", () => {
  expect(isConfigError(apiError(429))).toBe(false);
  expect(isConfigError(apiError(500))).toBe(false);
  expect(isConfigError(apiError(503))).toBe(false);
});

test("a non-API error (network/unknown) is not a config error", () => {
  expect(isConfigError(new Error("socket hang up"))).toBe(false);
  expect(isConfigError(undefined)).toBe(false);
});

// A rate limit self-heals on the provider's own clock; a broken provider does not.
// The breaker applied the same 10 minutes to both, so one 429 shifted every task onto
// the other provider for ten minutes — long enough for it to saturate and be parked
// too, which is how the pool reached no_providers_available in production.
const rateLimitError = (message: string, headers?: Record<string, string>) =>
  new OpenAI.APIError(429, undefined, message, headers ? new Headers(headers) : undefined);

test("retry-after is honoured when the provider sends one", () => {
  expect(rateLimitBackoffSec(rateLimitError("rate limited", { "retry-after": "7" }))).toBe(7);
});

test("Groq's prose wait is used when there is no retry-after header", () => {
  // The exact message seen in production, rounded up to whole seconds.
  const msg =
    "429 Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): " +
    "Limit 8000, Used 5972, Requested 2816. Please try again in 5.91s.";
  expect(rateLimitBackoffSec(rateLimitError(msg))).toBe(6);
});

test("the header wins over the message when both are present", () => {
  const err = rateLimitError("Please try again in 5.91s", { "retry-after": "12" });
  expect(rateLimitBackoffSec(err)).toBe(12);
});

test("an unparseable 429 falls back to a short wait, never the 10-minute park", () => {
  expect(rateLimitBackoffSec(rateLimitError("slow down"))).toBe(30);
  expect(rateLimitBackoffSec(new Error("socket hang up"))).toBe(30);
});

test("an absurd or hostile wait is capped", () => {
  expect(rateLimitBackoffSec(rateLimitError("x", { "retry-after": "99999" }))).toBe(120);
  expect(rateLimitBackoffSec(rateLimitError("x", { "retry-after": "-5" }))).toBe(30);
  expect(rateLimitBackoffSec(rateLimitError("x", { "retry-after": "banana" }))).toBe(30);
});

test("a sub-second wait still parks the provider for at least a second", () => {
  expect(rateLimitBackoffSec(rateLimitError("Please try again in 0.3s"))).toBe(1);
});

test("a 413 is a too-large refusal, not a broken provider", () => {
  // Groq's free tier counts prompt + max_tokens against 8000 TPM, so a big request
  // is refused outright. Parking the provider over it would push every SMALL task
  // off a provider that is working perfectly well.
  expect(isTooLarge(apiError(413))).toBe(true);
  expect(isConfigError(apiError(413))).toBe(false);
});

test("nothing else is mistaken for a too-large refusal", () => {
  for (const status of [400, 401, 403, 404, 429, 500, 503]) {
    expect(isTooLarge(apiError(status))).toBe(false);
  }
  expect(isTooLarge(new Error("boom"))).toBe(false);
});

// --- what fails over, and what stops the call (OUT-237) ---------------------
//
// The pool tries the next provider only for a status in this list; anything else hits
// `throw err` and the task dies on the first provider. 402 was missing, so when
// Cerebras (priority 1) ran out of credit on 2026-08-17 the three healthy providers
// behind it were never asked: every AI task failed, classify-change dead-lettered 982
// changes, and no signal was written for any org for twelve days while `changes` kept
// landing. A per-provider billing status is never a verdict on the request.

test("a provider out of credit fails over to the next one", () => {
  expect(shouldFailover(apiError(402))).toBe(true);
});

test("every other per-provider fault still fails over", () => {
  for (const status of [401, 403, 404, 413, 429, 500, 502, 503]) {
    expect(shouldFailover(apiError(status))).toBe(true);
  }
});

test("a request WE built wrong still fails fast — it would fail identically everywhere", () => {
  expect(shouldFailover(apiError(400))).toBe(false);
  expect(shouldFailover(new Error("socket hang up"))).toBe(false);
});

test("402 is its own diagnosis: no env var is wrong, an account needs topping up", () => {
  expect(isOutOfCredit(apiError(402))).toBe(true);
  expect(isConfigError(apiError(402))).toBe(false);
  expect(isTooLarge(apiError(402))).toBe(false);
});

test("nothing else is mistaken for an out-of-credit account", () => {
  for (const status of [400, 401, 403, 404, 413, 429, 500, 503]) {
    expect(isOutOfCredit(apiError(status))).toBe(false);
  }
  expect(isOutOfCredit(new Error("boom"))).toBe(false);
});

// --- per-request size ceiling ----------------------------------------------
//
// The 413 above is handled well AFTER it happens. The point of a published ceiling
// is to never spend the call: Groq's free tier caps one request at its 8000 TPM
// allowance, `generate_extractor` sends ~12k tokens of pruned HTML, so that pairing
// refused 198 times in a week while Cerebras served the same task 206 times. A
// guaranteed-413 attempt also consumes the pool's last failover slot, which is how
// an oversized prompt came back reading as "all_providers_failed".

const provider = (id: string, maxRequestTokens?: number): Provider => ({
  id,
  baseUrl: `https://${id}.example/v1`,
  apiKey: "k",
  model: "gpt-oss-120b",
  tier: "free",
  dailyTokenQuota: 1_000_000,
  maxRequestTokens,
  priority: 1,
});

test("the reply budget counts toward the request, because the free tiers bill it", () => {
  // 4000 chars ≈ 1000 prompt tokens; a 1024-token reply budget is charged against
  // the same allowance the provider refuses the request with.
  expect(estimateRequestTokens("x".repeat(4000), 1024)).toBe(2024);
  expect(estimateRequestTokens("", 0)).toBe(0);
});

test("a provider is skipped only when its ceiling is genuinely below the request", () => {
  const pool = [provider("groq", 8000), provider("cerebras")];

  // Structurally oversized (generate_extractor's real shape) → only the unbounded one.
  expect(providersAcceptingSize(pool, 12_201).map((p) => p.id)).toEqual(["cerebras"]);
  // A normal task still reaches both — this must not narrow the pool for everyone.
  expect(providersAcceptingSize(pool, 1_900).map((p) => p.id)).toEqual(["groq", "cerebras"]);
  // Exactly at the ceiling is acceptable; one token over is not.
  expect(providersAcceptingSize(pool, 8_000).map((p) => p.id)).toEqual(["groq", "cerebras"]);
  expect(providersAcceptingSize(pool, 8_001).map((p) => p.id)).toEqual(["cerebras"]);
});

test("an unset ceiling means unknown, never zero", () => {
  // Today's behaviour for every provider that has not declared one: attempt it and
  // let the provider answer. A ceiling of 0 in env must read the same way.
  expect(providersAcceptingSize([provider("mistral")], 999_999)).toHaveLength(1);
  expect(providersAcceptingSize([provider("mistral", 0)], 999_999)).toHaveLength(1);
});

// --- what a pool exhaustion means -------------------------------------------
//
// Only a "transient" verdict may reach recordFailure, and five of those in a row
// pause AI for the whole workspace. The empty-completion branch used to set no flag
// at all, so an exhaustion made only of empty replies landed here unlabelled and was
// counted as infra distress — the exact opposite of what its comment claimed.

const seen = (over: Partial<Parameters<typeof classifyExhaustion>[0]> = {}) => ({
  configError: false,
  transientError: false,
  outOfCredit: false,
  tooLarge: false,
  emptyCompletion: false,
  ...over,
});

test("empty replies from every provider are not an outage", () => {
  expect(classifyExhaustion(seen({ emptyCompletion: true }))).toBe("empty_replies");
});

test("a real transient fault outranks every request-shaped reading", () => {
  // Something WAS distressed: this is the one verdict allowed to feed the breaker.
  expect(classifyExhaustion(seen({ transientError: true }))).toBe("transient");
  expect(classifyExhaustion(seen({ transientError: true, emptyCompletion: true }))).toBe(
    "transient",
  );
  expect(classifyExhaustion(seen({ transientError: true, tooLarge: true }))).toBe("transient");
  expect(classifyExhaustion(seen({ transientError: true, configError: true }))).toBe("transient");
});

test("the pre-existing config and too-large verdicts are unchanged", () => {
  expect(classifyExhaustion(seen({ configError: true }))).toBe("misconfigured");
  expect(classifyExhaustion(seen({ tooLarge: true }))).toBe("too_large");
  // A bad key outranks a size refusal: fixing env is what unblocks the pool.
  expect(classifyExhaustion(seen({ configError: true, tooLarge: true }))).toBe("misconfigured");
  // A size refusal outranks an empty reply: it names the actionable budget.
  expect(classifyExhaustion(seen({ tooLarge: true, emptyCompletion: true }))).toBe("too_large");
});

test("a pool with no credit left names the top-up, not an env mistake", () => {
  expect(classifyExhaustion(seen({ outOfCredit: true }))).toBe("out_of_credit");
  // A bad key still outranks it: env is free to fix and blocks that provider outright.
  expect(classifyExhaustion(seen({ outOfCredit: true, configError: true }))).toBe("misconfigured");
  // And it outranks the two request-shaped readings, which say nothing is down.
  expect(classifyExhaustion(seen({ outOfCredit: true, tooLarge: true }))).toBe("out_of_credit");
  expect(classifyExhaustion(seen({ outOfCredit: true, emptyCompletion: true }))).toBe(
    "out_of_credit",
  );
});

test("one provider still answering 429 keeps the verdict transient", () => {
  // Not everything is permanently blocked: a busy provider clears on its own clock,
  // so this must not pause AI workspace-wide and demand a human.
  expect(classifyExhaustion(seen({ outOfCredit: true, transientError: true }))).toBe("transient");
});

test("an exhaustion with nothing observed still counts as transient", () => {
  // pickProvider returned null on the first pass (everyone parked or over quota):
  // no attempt was made, so nothing contradicts the pool being in distress.
  expect(classifyExhaustion(seen())).toBe("transient");
});
