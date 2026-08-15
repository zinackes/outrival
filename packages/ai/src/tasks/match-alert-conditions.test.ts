import { describe, expect, test } from "bun:test";
import {
  buildMatchAlertConditionsPrompt,
  matchAlertConditions,
  AlertConditionMatchSchema,
  type MatchAlertConditionsInput,
} from "./match-alert-conditions";

function input(overrides: Partial<MatchAlertConditionsInput> = {}): MatchAlertConditionsInput {
  return {
    conditions: [
      { id: "c1", condition: "Price drops below $50" },
      { id: "c2", condition: "Adds SSO to the free tier" },
    ],
    competitorName: "Linear",
    category: "pricing",
    severity: "high",
    insight: "Linear cut its Business plan from $16 to $12 per seat.",
    soWhat: null,
    changeBefore: null,
    changeAfter: null,
    ...overrides,
  };
}

describe("buildMatchAlertConditionsPrompt", () => {
  test("carries every condition with the id the model must return", () => {
    const prompt = buildMatchAlertConditionsPrompt(input());
    expect(prompt).toContain("id: c1");
    expect(prompt).toContain("Price drops below $50");
    expect(prompt).toContain("id: c2");
    expect(prompt).toContain("Adds SSO to the free tier");
  });

  test("carries the signal the conditions are judged against", () => {
    const prompt = buildMatchAlertConditionsPrompt(input());
    expect(prompt).toContain("Linear");
    expect(prompt).toContain("pricing");
    expect(prompt).toContain("Linear cut its Business plan from $16 to $12 per seat.");
  });

  test("includes the before/after only when the pipeline extracted one", () => {
    expect(buildMatchAlertConditionsPrompt(input())).not.toContain("What moved");
    const withMove = buildMatchAlertConditionsPrompt(
      input({ changeBefore: "Business · $16/seat", changeAfter: "Business · $12/seat" }),
    );
    expect(withMove).toContain('What moved: "Business · $16/seat" → "Business · $12/seat"');
  });

  test("a half-extracted before/after is left out rather than shown alone", () => {
    const prompt = buildMatchAlertConditionsPrompt(input({ changeBefore: "Business · $16/seat" }));
    expect(prompt).not.toContain("What moved");
  });

  test("blank soWhat adds no empty section", () => {
    expect(buildMatchAlertConditionsPrompt(input({ soWhat: "   " }))).not.toContain(
      "Why it matters",
    );
  });

  test("tells the model to abstain when unsure, and to answer in JSON only", () => {
    const prompt = buildMatchAlertConditionsPrompt(input());
    expect(prompt).toContain("leave the condition out");
    expect(prompt).toContain('{ "matchedIds": ["..."] }');
  });
});

describe("matchAlertConditions", () => {
  test("no conditions means no call and no match", async () => {
    // Would throw on a network call: there is no provider configured in tests.
    await expect(matchAlertConditions(input({ conditions: [] }))).resolves.toEqual({
      matchedIds: [],
    });
  });
});

describe("AlertConditionMatchSchema", () => {
  test("a reply with no matchedIds key is an empty match, not a parse failure", () => {
    expect(AlertConditionMatchSchema.parse({})).toEqual({ matchedIds: [] });
  });

  test("a non-array matchedIds is rejected rather than coerced", () => {
    expect(AlertConditionMatchSchema.safeParse({ matchedIds: "c1" }).success).toBe(false);
  });
});
