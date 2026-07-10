import { describe, expect, test } from "bun:test";
import { AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { retriableClassifyError } from "../src/lib/classify-errors";

// ÉTAPE 4 guardrail (2026-07 audit, R2) — a classify parse miss (null result) is a
// TRANSIENT free-provider failure and MUST stay retriable. It was once a
// non-retriable AbortTaskRunError, which dropped the signal permanently (the change
// stayed orphaned, no later scrape recreated it). This locks the invariant so a
// future edit can't quietly turn the parse-fail path back into a silent abort.
describe("retriableClassifyError", () => {
  test("is a retriable error, NOT a non-retriable AbortTaskRunError", () => {
    const err = retriableClassifyError("change-123");
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AbortTaskRunError);
    expect(err.name).toBe("Error");
  });

  test("names the change so the failure is traceable in the dead-letter", () => {
    expect(retriableClassifyError("change-123").message).toContain("change-123");
  });
});
