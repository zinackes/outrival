import { test, expect } from "bun:test";
import { resolveReasoningEffort } from "./provider";

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
