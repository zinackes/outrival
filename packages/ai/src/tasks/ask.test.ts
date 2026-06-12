import { describe, expect, it } from "bun:test";
import {
  AskPlanSchema,
  AskAnswerSchema,
  buildAskPlanPrompt,
  buildAskSynthesisPrompt,
  type AskToolSpec,
} from "./ask";

const TOOLS: AskToolSpec[] = [
  { name: "getSignals", description: "Recent signals.", args: "window (days)" },
  { name: "getPricingHistory", description: "Pricing.", args: "competitorId (required)" },
];

describe("AskPlanSchema", () => {
  it("parses a valid plan", () => {
    const r = AskPlanSchema.safeParse({
      calls: [{ tool: "getSignals", args: { window: 30 } }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.calls[0]?.tool).toBe("getSignals");
  });

  it("defaults args to an empty object", () => {
    const r = AskPlanSchema.safeParse({ calls: [{ tool: "listCompetitors" }] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.calls[0]?.args).toEqual({});
  });

  it("defaults to an empty call list", () => {
    const r = AskPlanSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.calls).toEqual([]);
  });

  it("caps the number of calls at 6", () => {
    const calls = Array.from({ length: 7 }, () => ({ tool: "getSignals" }));
    expect(AskPlanSchema.safeParse({ calls }).success).toBe(false);
  });
});

describe("AskAnswerSchema", () => {
  it("parses an answer with citations", () => {
    const r = AskAnswerSchema.safeParse({
      answer: "Linear raised its Pro plan.",
      citations: [{ type: "competitor", id: "abc", label: "Linear" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown citation type", () => {
    const r = AskAnswerSchema.safeParse({
      answer: "x",
      citations: [{ type: "invoice", id: "1", label: "x" }],
    });
    expect(r.success).toBe(false);
  });

  it("defaults citations to an empty array", () => {
    const r = AskAnswerSchema.safeParse({ answer: "No data." });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.citations).toEqual([]);
  });
});

describe("buildAskPlanPrompt", () => {
  it("injects the roster so the model resolves names to ids", () => {
    const prompt = buildAskPlanPrompt("What changed at Linear?", TOOLS, [
      { id: "comp-1", name: "Linear" },
    ]);
    expect(prompt).toContain('Linear → id "comp-1"');
    expect(prompt).toContain("getSignals(window (days))");
    expect(prompt).toContain("What changed at Linear?");
  });

  it("handles an empty roster without crashing", () => {
    const prompt = buildAskPlanPrompt("anything", TOOLS, []);
    expect(prompt).toContain("(no competitors tracked yet)");
  });
});

describe("buildAskSynthesisPrompt", () => {
  it("embeds the tool results and forbids invention", () => {
    const prompt = buildAskSynthesisPrompt("Who is hiring?", [
      { tool: "getJobTrends", result: { totalOpen: 12 } },
    ]);
    expect(prompt).toContain('"totalOpen": 12');
    expect(prompt).toContain("Do NOT invent");
    expect(prompt).toContain("Who is hiring?");
  });
});
