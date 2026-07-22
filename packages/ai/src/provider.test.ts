import { test, expect } from "bun:test";
import OpenAI from "openai";
import { resolveReasoningEffort, isConfigError, rateLimitBackoffSec } from "./provider";

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
