import { describe, expect, test } from "bun:test";
import {
  aggregate,
  computeDeltas,
  promptNamesSubject,
  type VisibilityRow,
} from "../src/lib/ai-visibility/diff";

// Pure share-of-voice diff (phase 3). One engine ("p"), self = "self".
const row = (
  promptId: string,
  competitorId: string,
  mentioned: boolean,
  rank: number | null = null,
  promptNamed = false,
): VisibilityRow => ({ engine: "p", promptId, competitorId, mentioned, rank, promptNamed });

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

  test("competitor flat while self collapses → no overtaken (self-decline, not an overtake)", () => {
    // self 1.0 → 0.5 (fell, but not to 0 → self_dropped does NOT fire), c1 flat at 1.0.
    // Pre-fix this wrongly emitted a HIGH "c1 overtook you"; c1 never gained ground.
    const prev = run({ self: ["p1", "p2"], c1: ["p1", "p2"] });
    const curr = run({ self: ["p1"], c1: ["p1", "p2"] });
    expect(deltas(prev, curr)).toEqual([]);
  });

  test("competitor genuinely rises above self → overtaken still fires (no over-correction)", () => {
    const prev = run({ self: ["p1", "p2"], c1: ["p1"] }); // self 1.0 >= c1 0.5
    const curr = run({ self: ["p1"], c1: ["p1", "p2"] }); // c1 0.5 → 1.0 (rose) > self 0.5
    const d = deltas(prev, curr);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ type: "overtaken", competitorId: "c1", severity: "high" });
  });

  test("minPrompts gate: a run below the sample floor emits nothing (quota-noise guard)", () => {
    // 2-prompt runs (the fixtures' default) with a floor of 3 → no signal, even for a
    // shift that would otherwise fire. This is the prod case: 2 answered Gemini prompts
    // giving 100%/50% SoV is quota starvation, not a market move.
    const prev = run({ self: ["p1", "p2"], c1: [] });
    const curr = run({ self: ["p1", "p2"], c1: ["p1"] }); // c1 "appeared" at 0.5
    expect(computeDeltas(aggregate(prev), aggregate(curr), "self", 3)).toEqual([]);
    // Same shift clears a floor of 2 → still fires (both runs have 2 prompts).
    expect(computeDeltas(aggregate(prev), aggregate(curr), "self", 2)).toHaveLength(1);
  });
});

describe("promptNamesSubject — the prompt names a brand", () => {
  test("matches the full brand name, case-insensitive, across punctuation boundaries", () => {
    expect(promptNamesSubject("Compare ZAP-Hosting and X for uptime", "ZAP-Hosting")).toBe(true);
    expect(promptNamesSubject("which is better, iceline hosting?", "Iceline Hosting")).toBe(true);
  });
  test("does not false-positive on a substring of a longer word", () => {
    expect(promptNamesSubject("What is the best hosting for games?", "Host")).toBe(false);
  });
  test("empty / too-short names never match", () => {
    expect(promptNamesSubject("anything", "")).toBe(false);
  });
});

describe("aggregate — seeded (prompt-named) pairs excluded from organic SoV", () => {
  test("a subject the prompt names is dropped from its own numerator AND denominator", () => {
    // p1 names c1 (seeded, guaranteed mention); p2 is un-branded. self is never named.
    const rows: VisibilityRow[] = [
      row("p1", "c1", true, 1, true), // seeded hit → must not count
      row("p2", "c1", false, null, false), // organic miss
      row("p1", "self", false, null, false),
      row("p2", "self", true, 1, false),
    ];
    const agg = aggregate(rows).get("p");
    // c1: seeded p1 excluded → only p2 (organic miss) counts → 0/1 = 0, NOT 1/2 = 0.5.
    expect(agg?.subjects.get("c1")).toMatchObject({ mentions: 0, sov: 0 });
    // self: both prompts organic, mentioned once → 0.5.
    expect(agg?.subjects.get("self")).toMatchObject({ mentions: 1, sov: 0.5 });
  });
});
