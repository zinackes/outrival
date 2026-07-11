import { describe, expect, mock, test } from "bun:test";
import {
  evaluateFreshAnswer,
  matchesStandingQuery,
  nextHysteresisState,
  type EvaluableStandingQuery,
  type FreshAskAnswer,
  type MatchableStandingQuery,
  type TriggeringSignal,
} from "../src/lib/standing-queries";

// The three guarantees of standing queries, locked as unit tests:
// (a) TARGETED trigger — a query re-evaluates only for signals touching its
//     watched entities; (b) change = cited-signal SETS, so a reformulated answer
//     can never alert and the judge is never consulted for it; (c) hysteresis —
//     an alert needs 2 consecutive material evaluations.

const baseQuery: MatchableStandingQuery = {
  isActive: true,
  watchedCompetitorIds: ["comp-a"],
  watchedCategories: ["pricing"],
  minSeverity: "low",
  cooldownHours: 6,
  lastEvaluatedAt: null,
};

const signal = (over: Partial<TriggeringSignal> = {}): TriggeringSignal => ({
  competitorId: "comp-a",
  category: "pricing",
  severity: "medium",
  ...over,
});

describe("(a) targeted trigger — matchesStandingQuery", () => {
  test("matches a signal on a watched competitor + category", () => {
    expect(matchesStandingQuery(signal(), baseQuery)).toBe(true);
  });

  test("does NOT match a signal on another competitor", () => {
    expect(matchesStandingQuery(signal({ competitorId: "comp-b" }), baseQuery)).toBe(false);
  });

  test("does NOT match a signal in an unwatched category", () => {
    expect(matchesStandingQuery(signal({ category: "hiring" }), baseQuery)).toBe(false);
  });

  test("empty watched lists are org-wide wildcards", () => {
    const wildcard = { ...baseQuery, watchedCompetitorIds: [], watchedCategories: [] };
    expect(
      matchesStandingQuery(signal({ competitorId: "comp-z", category: "funding" }), wildcard),
    ).toBe(true);
  });

  test("minSeverity floors the trigger", () => {
    const picky = { ...baseQuery, minSeverity: "high" as const };
    expect(matchesStandingQuery(signal({ severity: "medium" }), picky)).toBe(false);
    expect(matchesStandingQuery(signal({ severity: "high" }), picky)).toBe(true);
    expect(matchesStandingQuery(signal({ severity: "critical" }), picky)).toBe(true);
  });

  test("cooldown suppresses a recent re-evaluation, elapses after the window", () => {
    const now = new Date("2026-07-10T12:00:00Z");
    const recent = { ...baseQuery, lastEvaluatedAt: new Date("2026-07-10T11:00:00Z") };
    expect(matchesStandingQuery(signal(), recent, now)).toBe(false);
    const stale = { ...baseQuery, lastEvaluatedAt: new Date("2026-07-10T05:00:00Z") };
    expect(matchesStandingQuery(signal(), stale, now)).toBe(true);
  });

  test("a paused query never matches", () => {
    expect(matchesStandingQuery(signal(), { ...baseQuery, isActive: false })).toBe(false);
  });
});

const evalQuery = (over: Partial<EvaluableStandingQuery> = {}): EvaluableStandingQuery => ({
  orgId: "org-1",
  question: "What is Acme doing on pricing?",
  currentAnswer: "Acme sells a $49 Pro plan and a $99 Team plan.",
  currentSignalIds: ["s1", "s2"],
  pendingCount: 0,
  ...over,
});

const freshAnswer = (signalIds: string[], answer: string): FreshAskAnswer => ({
  answer,
  citations: [
    { type: "competitor", id: "comp-a", label: "Acme" },
    ...signalIds.map((id) => ({ type: "signal" as const, id, label: "Signal" })),
  ],
});

const deps = (judgeResult: { materiallyChanged: boolean; changeSummary: string } | null) => {
  const judge = mock(() => Promise.resolve(judgeResult));
  return { judge, fetchInsights: mock(() => Promise.resolve([] as string[])) };
};

describe("(b) cited-signal sets decide change — reformulation never alerts", () => {
  test("same set, completely reworded answer → no_change and the judge is NEVER called", async () => {
    const d = deps({ materiallyChanged: true, changeSummary: "should not matter" });
    const { outcome } = await evaluateFreshAnswer(
      evalQuery(),
      // Same signals cited in a different order — only the prose changed.
      freshAnswer(["s2", "s1"], "Acme's pricing is built around two tiers, Pro and Team."),
      d,
    );
    expect(outcome).toEqual({ action: "no_change" });
    expect(d.judge).not.toHaveBeenCalled();
  });

  test("different set + material judgement → walks toward an alert", async () => {
    const d = deps({ materiallyChanged: true, changeSummary: "Acme raised Pro to $59." });
    // First evaluation with the changed set: armed, not alerted (hysteresis).
    const first = await evaluateFreshAnswer(
      evalQuery(),
      freshAnswer(["s1", "s3"], "Acme now sells Pro at $59."),
      d,
    );
    expect(first.outcome).toEqual({ action: "pending", pendingCount: 1 });
    expect(d.judge).toHaveBeenCalledTimes(1);

    // Second evaluation, change persists → alert.
    const second = await evaluateFreshAnswer(
      evalQuery({ pendingCount: 1 }),
      freshAnswer(["s1", "s3"], "Acme now sells Pro at $59."),
      d,
    );
    expect(second.outcome).toEqual({
      action: "alert",
      changeSummary: "Acme raised Pro to $59.",
    });
    expect(second.freshSignalIds).toEqual(["s1", "s3"]);
  });

  test("different set but judge says evidence rotation only → no alert, counter reset", async () => {
    const d = deps({ materiallyChanged: false, changeSummary: "" });
    const { outcome } = await evaluateFreshAnswer(
      evalQuery({ pendingCount: 1 }),
      freshAnswer(["s1", "s3"], "Same facts, new citations."),
      d,
    );
    expect(outcome).toEqual({ action: "pending", pendingCount: 0 });
  });

  test("judge unavailable → hysteresis state untouched", async () => {
    const d = deps(null);
    const { outcome } = await evaluateFreshAnswer(
      evalQuery({ pendingCount: 1 }),
      freshAnswer(["s1", "s3"], "New answer."),
      d,
    );
    expect(outcome).toEqual({ action: "judge_unavailable" });
  });
});

describe("(c) hysteresis — alert only when the change persists 2 evaluations", () => {
  test("first material evaluation arms without alerting", () => {
    expect(nextHysteresisState(0, true)).toEqual({ pendingCount: 1, alert: false });
  });

  test("second consecutive material evaluation alerts and resets", () => {
    expect(nextHysteresisState(1, true)).toEqual({ pendingCount: 0, alert: true });
  });

  test("a non-persistent change disarms without ever alerting", () => {
    // material once → back to baseline on the next evaluation → reset, no alert.
    expect(nextHysteresisState(0, true)).toEqual({ pendingCount: 1, alert: false });
    expect(nextHysteresisState(1, false)).toEqual({ pendingCount: 0, alert: false });
  });

  test("nothing material, nothing pending", () => {
    expect(nextHysteresisState(0, false)).toEqual({ pendingCount: 0, alert: false });
  });
});
