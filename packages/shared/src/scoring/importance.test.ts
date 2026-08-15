import { describe, expect, test } from "bun:test";
import { decideImportance, type ImportanceInput } from "./importance";

/** A signal that would be important on severity alone, so each test can knock out one leg. */
function input(overrides: Partial<ImportanceInput> = {}): ImportanceInput {
  return {
    severity: "high",
    materiality: null,
    relevanceScore: null,
    ...overrides,
  };
}

describe("decideImportance — the user's own conditions win", () => {
  test("a matched condition is important, whatever the severity says", () => {
    const verdict = decideImportance(
      input({ severity: "low", matchedConditions: ["price drops below $50"] }),
    );
    expect(verdict.important).toBe(true);
    expect(verdict.reason).toBe("Matches your alert “price drops below $50”");
  });

  test("several matches quote the first and count the rest", () => {
    const verdict = decideImportance(
      input({ matchedConditions: ["price drops below $50", "adds SSO", "ships an SDK"] }),
    );
    expect(verdict.reason).toBe("Matches your alert “price drops below $50” (+2 more)");
  });

  test("a matched condition beats backfill, which would otherwise mute it", () => {
    const verdict = decideImportance(
      input({ severity: "critical", isBackfill: true, matchedConditions: ["any pricing move"] }),
    );
    expect(verdict.important).toBe(true);
  });

  test("an empty condition list is not a match", () => {
    const verdict = decideImportance(input({ severity: "low", matchedConditions: [] }));
    expect(verdict.important).toBe(false);
  });
});

describe("decideImportance — archive backfill", () => {
  test("a reconstructed change is real but never important on its own", () => {
    const verdict = decideImportance(input({ severity: "critical", isBackfill: true }));
    expect(verdict.important).toBe(false);
    expect(verdict.reason).toBe("Historical move, reconstructed from the archive");
  });
});

describe("decideImportance — severity bands", () => {
  test("critical and high are important", () => {
    expect(decideImportance(input({ severity: "critical" })).important).toBe(true);
    expect(decideImportance(input({ severity: "high" })).important).toBe(true);
  });

  test("low is never important, however it scored", () => {
    const verdict = decideImportance(
      input({
        severity: "low",
        materiality: { decisionImpact: 3, urgency: 3, corroboration: 3 },
        relevanceScore: 1,
      }),
    );
    expect(verdict.important).toBe(false);
  });

  test("with no sub-scores the band supplies the reason", () => {
    expect(decideImportance(input({ severity: "critical" })).reason).toBe(
      "Direct threat to how you win deals",
    );
    expect(decideImportance(input({ severity: "high" })).reason).toBe(
      "Material competitive move",
    );
  });
});

describe("decideImportance — the sub-score carries the reason", () => {
  test("decision impact is checked before the other two", () => {
    const verdict = decideImportance(
      input({ materiality: { decisionImpact: 2, urgency: 3, corroboration: 3 } }),
    );
    expect(verdict.reason).toBe("Changes something you price or position against");
  });

  test("urgency answers when decision impact is weak", () => {
    const verdict = decideImportance(
      input({ materiality: { decisionImpact: 1, urgency: 2, corroboration: 0 } }),
    );
    expect(verdict.reason).toBe("Moving now, so the window to respond is open");
  });

  test("corroboration explains an important signal, last", () => {
    const verdict = decideImportance(
      input({ materiality: { decisionImpact: 0, urgency: 0, corroboration: 2 } }),
    );
    expect(verdict.reason).toBe("Part of a broader run of moves by this competitor");
  });

  test("all-weak sub-scores fall back to the band, not to silence", () => {
    const verdict = decideImportance(
      input({ materiality: { decisionImpact: 1, urgency: 1, corroboration: 1 } }),
    );
    expect(verdict.reason).toBe("Material competitive move");
  });
});

describe("decideImportance — the medium band is where it earns its keep", () => {
  test("an ordinary medium is not important, and says why not", () => {
    const verdict = decideImportance(
      input({
        severity: "medium",
        materiality: { decisionImpact: 1, urgency: 1, corroboration: 0 },
        relevanceScore: 0.4,
      }),
    );
    expect(verdict.important).toBe(false);
    expect(verdict.reason).toBe("Real change, no impact on a decision you own");
  });

  test("a strong decision impact promotes a medium", () => {
    const verdict = decideImportance(
      input({
        severity: "medium",
        materiality: { decisionImpact: 2, urgency: 0, corroboration: 0 },
      }),
    );
    expect(verdict.important).toBe(true);
    expect(verdict.reason).toBe("Changes something you price or position against");
  });

  test("high composite relevance promotes a medium with no sub-scores at all", () => {
    const verdict = decideImportance(input({ severity: "medium", relevanceScore: 0.85 }));
    expect(verdict.important).toBe(true);
    expect(verdict.reason).toBe("High relevance to the pages you compete on");
  });

  test("relevance just under the bar does not promote", () => {
    expect(
      decideImportance(input({ severity: "medium", relevanceScore: 0.69 })).important,
    ).toBe(false);
    expect(
      decideImportance(input({ severity: "medium", relevanceScore: 0.7 })).important,
    ).toBe(true);
  });
});

describe("decideImportance — the reason is always usable", () => {
  const cases: ImportanceInput[] = [
    input({ severity: "critical" }),
    input({ severity: "high", materiality: { decisionImpact: 3, urgency: 0, corroboration: 0 } }),
    input({ severity: "medium", relevanceScore: 0.9 }),
    input({ severity: "medium", relevanceScore: 0 }),
    input({ severity: "low" }),
    input({ isBackfill: true }),
    input({ matchedConditions: ["a very long alert condition written by the user"] }),
  ];

  test("never empty, never a bare severity word, and short enough to render", () => {
    for (const c of cases) {
      const { reason } = decideImportance(c);
      expect(reason.length).toBeGreaterThan(0);
      expect(reason.length).toBeLessThanOrEqual(90);
      expect(reason.toLowerCase()).not.toBe(c.severity);
    }
  });
});
