import { describe, expect, test } from "bun:test";
import { DeadLetter, NonRetriable, deadLetterPayload, isDeadLetteredOutput } from "@outrival/queue";
import { retriableClassifyError, truncatedReplyError } from "../src/lib/classify-errors";

// Véracité Intelligence v2 P3 — the retry semantics of a parse miss under pg-boss.
//
// Two failures look identical at the call site (a null result) and must be treated
// as opposites:
//   - malformed JSON → transient on the free reasoning providers → RETRIABLE;
//   - a reply cut off at max_tokens → reproduces exactly on a re-run → DEAD-LETTER,
//     once, with the payload intact.
// Neither may ever be a quiet completion: that is what used to lose a change its
// signal for good.
describe("truncatedReplyError", () => {
  test("is a DeadLetter with a distinct, queryable reason", () => {
    const err = truncatedReplyError("Insight", "change-123");
    expect(err).toBeInstanceOf(DeadLetter);
    expect(err.reason).toBe("truncated_reply");
  });

  test("is NOT a NonRetriable — a silent completion is exactly the old bug", () => {
    expect(truncatedReplyError("Classification", "change-123")).not.toBeInstanceOf(NonRetriable);
  });

  test("names the change and what truncated, so the dead letter is readable", () => {
    const message = truncatedReplyError("Insight", "change-123").message;
    expect(message).toContain("change-123");
    expect(message).toContain("Insight");
    expect(message).toContain("maxTokens");
  });

  test("the two parse-miss paths stay distinguishable", () => {
    expect(retriableClassifyError("change-123")).not.toBeInstanceOf(DeadLetter);
  });
});

describe("deadLetterPayload", () => {
  test("carries the original payload verbatim, so a replay recreates the signal", () => {
    const original = { changeId: "change-123", classification: { severity: "high" } };
    const parked = deadLetterPayload("generate-signal", original, "truncated_reply", "job-9");

    // The replay is literally "send this payload back to the queue it names": the
    // change was never marked done, and generate-signal is idempotent by changeId.
    const { __dlq, ...replayable } = parked;
    expect(replayable).toEqual(original);
    expect(__dlq).toEqual({ queue: "generate-signal", reason: "truncated_reply", jobId: "job-9" });
  });

  test("a dead-lettered job's output is recognisable, never a bare success", () => {
    expect(isDeadLetteredOutput({ deadLettered: true, reason: "truncated_reply", queue: "q" })).toBe(
      true,
    );
    expect(isDeadLetteredOutput({ signalId: "s1" })).toBe(false);
  });
});
