import { describe, expect, test } from "bun:test";
import { aggregate, promptNamesSubject, type VisibilityRow } from "../src/lib/ai-visibility/diff";

// Per-run share of voice. One engine ("p"), self = "self".
//
// The run-to-run delta this file used to cover was replaced in Positioning
// Intelligence v2 P5 by the 28-day window shift (`ai-visibility-shift.test.ts`).
// What is left here is what the onboarding teaser still runs on.
const row = (
  promptId: string,
  competitorId: string,
  mentioned: boolean,
  rank: number | null = null,
  promptNamed = false,
): VisibilityRow => ({ engine: "p", promptId, competitorId, mentioned, rank, promptNamed });

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
