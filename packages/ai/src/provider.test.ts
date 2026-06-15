import { test, expect } from "bun:test";
import OpenAI from "openai";
import { resolveReasoningEffort, isConfigError } from "./provider";

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
