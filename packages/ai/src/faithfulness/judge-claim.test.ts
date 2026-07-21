import { describe, expect, test } from "bun:test";
import { JudgeSchema, buildJudgePrompt } from "./judge-claim";

// The judge is binary BY CONSTRUCTION, not by convention: a model that answers with
// a 1-5 score must fail to parse (→ null → fail open) rather than have its number
// silently thresholded by whoever reads it next.

describe("JudgeSchema", () => {
  test("accepts a binary verdict", () => {
    const r = JudgeSchema.safeParse({ faithful: false, reason: "absent from the source" });
    expect(r.success).toBe(true);
  });

  test("rejects a 1-5 scale", () => {
    expect(JudgeSchema.safeParse({ faithful: 4, reason: "mostly ok" }).success).toBe(false);
    expect(JudgeSchema.safeParse({ score: 4, reason: "mostly ok" }).success).toBe(false);
  });

  test("rejects a confidence-flavoured string verdict", () => {
    expect(JudgeSchema.safeParse({ faithful: "medium", reason: "eh" }).success).toBe(false);
  });
});

describe("buildJudgePrompt", () => {
  const source = "Starter — $49/month\nGrowth — $199/month";

  test("carries the claim, the offered quote and the source", () => {
    const p = buildJudgePrompt(
      { text: "Starter costs $49/month.", citedQuote: "Starter — $49/month" },
      source,
    );
    expect(p).toContain("Starter costs $49/month.");
    expect(p).toContain("Starter — $49/month");
    expect(p).toContain("Growth — $199/month");
  });

  test("says so explicitly when the AI offered no quote at all", () => {
    const p = buildJudgePrompt({ text: "Acme is SOC 2 certified.", citedQuote: "" }, source);
    expect(p).toContain("no supporting quote");
  });
});
