import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearDbOverride, setDbOverride } from "./db-harness";
import { evaluateAlertConditions } from "../src/lib/alert-conditions";

// evaluateAlertConditions is the last thing generate-signal calls BEFORE inserting the
// signal row, and its contract is "never throws": a match only adds an importance badge,
// so nothing it does may cost the signal itself. The AI call and the counter update were
// guarded from the start; the rule-set READ was not, and an unguarded throw there takes
// out signal generation for every org on every change while `changes` keep being written
// — Activity alive, feed permanently empty (OUT-237). This locks the read.

const state: { fail: boolean; rows: Array<{ id: string; condition: string }> } = {
  fail: false,
  rows: [],
};

// Decision logic, not SQL: a hand-written `db` installed as an OVERRIDE, per the
// db-harness contract. Only the one chain the function issues is modelled.
const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () =>
          state.fail
            ? Promise.reject(new Error('relation "alert_conditions" does not exist'))
            : Promise.resolve(state.rows),
      }),
    }),
  }),
};

const INPUT = {
  orgId: "org_1",
  competitorId: "comp_1",
  competitorName: "Acme",
  category: "pricing",
  severity: "high",
  insight: "Acme cut the Standard plan to $79/mo.",
  soWhat: null,
  changeBefore: "Standard · $99/mo",
  changeAfter: "Standard · $79/mo",
};

describe("evaluateAlertConditions", () => {
  beforeEach(() => setDbOverride(fakeDb));
  afterEach(() => {
    state.fail = false;
    state.rows = [];
  });
  afterAll(() => clearDbOverride());

  test("no conditions → matched nothing, no AI call", async () => {
    expect(await evaluateAlertConditions(INPUT)).toEqual({ matchedIds: [], matchedTexts: [] });
  });

  test("unreadable rule set → matched nothing, never throws", async () => {
    state.fail = true;
    expect(await evaluateAlertConditions(INPUT)).toEqual({ matchedIds: [], matchedTexts: [] });
  });
});
