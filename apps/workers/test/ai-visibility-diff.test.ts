import { describe, expect, test } from "bun:test";
import {
  aggregate,
  computeDeltas,
  type VisibilityRow,
} from "../src/lib/ai-visibility/diff";

// Pure share-of-voice diff (phase 3). One engine ("p"), self = "self".
const row = (
  promptId: string,
  competitorId: string,
  mentioned: boolean,
  rank: number | null = null,
): VisibilityRow => ({ engine: "p", promptId, competitorId, mentioned, rank });

// Helper: build a run where, on prompts p1+p2, each subject is mentioned on the
// listed prompts (so sov = mentions / 2).
function run(spec: Record<string, string[]>): VisibilityRow[] {
  const rows: VisibilityRow[] = [];
  const prompts = ["p1", "p2"];
  for (const [cid, hit] of Object.entries(spec)) {
    for (const p of prompts) rows.push(row(p, cid, hit.includes(p)));
  }
  return rows;
}

const deltas = (prev: VisibilityRow[], curr: VisibilityRow[], self = "self") =>
  computeDeltas(aggregate(prev), aggregate(curr), self);

describe("computeDeltas — AI visibility shifts", () => {
  test("no previous baseline → no signals (first run)", () => {
    const curr = run({ self: ["p1", "p2"], c1: ["p1"] });
    expect(deltas([], curr)).toEqual([]);
  });

  test("identical runs → no signals (idempotent on re-run)", () => {
    const r = run({ self: ["p1", "p2"], c1: ["p1"] });
    expect(deltas(r, r)).toEqual([]);
  });

  test("self drops out of an engine → one self_dropped", () => {
    const prev = run({ self: ["p1", "p2"], c1: ["p1"] }); // self 1.0, c1 0.5
    const curr = run({ self: [], c1: [] }); // self 0, c1 0
    const d = deltas(prev, curr);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ type: "self_dropped", competitorId: "self", severity: "high" });
  });

  test("competitor overtakes self → one overtaken", () => {
    const prev = run({ self: ["p1", "p2"], c1: ["p1"] }); // self 1.0 >= c1 0.5
    const curr = run({ self: ["p1"], c1: ["p1", "p2"] }); // c1 1.0 > self 0.5
    const d = deltas(prev, curr);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ type: "overtaken", competitorId: "c1", severity: "high" });
  });

  test("new competitor appears (self still ahead) → one competitor_appeared", () => {
    const prev = run({ self: ["p1", "p2"], c1: [] }); // c1 absent
    const curr = run({ self: ["p1", "p2"], c1: ["p1"] }); // c1 0.5 < self 1.0
    const d = deltas(prev, curr);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ type: "competitor_appeared", competitorId: "c1", severity: "medium" });
  });

  test("no self product → self/overtake cases skipped, appearance still fires", () => {
    const prev = run({ c1: [] });
    const curr = run({ c1: ["p1"] });
    const d = computeDeltas(aggregate(prev), aggregate(curr), null);
    expect(d).toHaveLength(1);
    expect(d[0]?.type).toBe("competitor_appeared");
  });
});
