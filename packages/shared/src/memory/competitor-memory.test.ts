import { describe, expect, test } from "bun:test";
import {
  buildCompetitorMemory,
  memoryFactText,
  relativeAge,
  storySummary,
  type MemorySignalRow,
} from "./competitor-memory";

const NOW = new Date("2026-08-13T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function row(over: Partial<MemorySignalRow> = {}): MemorySignalRow {
  return {
    competitorId: "c1",
    competitor: "Acme",
    category: "pricing",
    before: "Standard · $99/mo",
    after: "Standard · $79/mo",
    at: daysAgo(10),
    ...over,
  };
}

describe("relativeAge", () => {
  test("collapses to the coarsest unit that still says it", () => {
    expect(relativeAge(daysAgo(0), NOW)).toBe("today");
    expect(relativeAge(daysAgo(1), NOW)).toBe("yesterday");
    expect(relativeAge(daysAgo(4), NOW)).toBe("4 days ago");
    expect(relativeAge(daysAgo(7), NOW)).toBe("1 week ago");
    expect(relativeAge(daysAgo(20), NOW)).toBe("3 weeks ago");
    expect(relativeAge(daysAgo(45), NOW)).toBe("2 months ago");
    expect(relativeAge(daysAgo(400), NOW)).toBe("1 year ago");
  });

  test("a future timestamp reads as today rather than as a negative age", () => {
    expect(relativeAge(new Date(NOW.getTime() + 86_400_000), NOW)).toBe("today");
  });

  test("accepts an ISO string as well as a Date", () => {
    expect(relativeAge(daysAgo(20).toISOString(), NOW)).toBe("3 weeks ago");
  });
});

describe("buildCompetitorMemory", () => {
  test("one change is not a trajectory — below the threshold nothing is told", () => {
    const { stories } = buildCompetitorMemory([row()], { now: NOW });
    expect(stories).toEqual([]);
  });

  test("groups by competitor, oldest fact first, since = the first one", () => {
    const { stories } = buildCompetitorMemory(
      [
        row({ at: daysAgo(3), after: "Standard · $79/mo" }),
        row({ at: daysAgo(90), after: "Standard · $99/mo", before: null }),
        row({ at: daysAgo(30), after: "Standard · $89/mo" }),
      ],
      { now: NOW },
    );
    expect(stories).toHaveLength(1);
    const story = stories[0]!;
    expect(story.facts.map((f) => f.after)).toEqual([
      "Standard · $99/mo",
      "Standard · $89/mo",
      "Standard · $79/mo",
    ]);
    expect(story.since).toBe(daysAgo(90).toISOString());
    expect(story.sinceLabel).toBe("May 15, 2026");
    expect(story.total).toBe(3);
    expect(story.facts[0]!.ago).toBe("3 months ago");
  });

  test("ranks by depth of knowledge, caps at three, reports the rest", () => {
    const rows: MemorySignalRow[] = [];
    // 4 competitors with 5, 4, 3 and 2 facts each.
    [5, 4, 3, 2].forEach((n, i) => {
      for (let k = 0; k < n; k++) {
        rows.push(
          row({
            competitorId: `c${i}`,
            competitor: `Comp${i}`,
            at: daysAgo(50 - k),
            after: `state ${k}`,
          }),
        );
      }
    });
    const { stories, omitted } = buildCompetitorMemory(rows, { now: NOW });
    expect(stories.map((s) => s.competitor)).toEqual(["Comp0", "Comp1", "Comp2"]);
    expect(omitted).toBe(1);
  });

  test("keeps the most recent facts but still dates the story from the first", () => {
    const rows = Array.from({ length: 9 }, (_, k) =>
      row({ at: daysAgo(100 - k * 10), after: `state ${k}` }),
    );
    const { stories } = buildCompetitorMemory(rows, { now: NOW });
    const story = stories[0]!;
    expect(story.total).toBe(9);
    expect(story.facts).toHaveLength(5);
    expect(story.facts.map((f) => f.after)).toEqual([
      "state 4",
      "state 5",
      "state 6",
      "state 7",
      "state 8",
    ]);
    expect(story.since).toBe(daysAgo(100).toISOString());
  });

  test("a row we could not restate carries no fact and is dropped", () => {
    const { stories } = buildCompetitorMemory(
      [row({ after: null }), row({ after: "   " }), row({ at: daysAgo(2) })],
      { now: NOW, minFacts: 1 },
    );
    expect(stories[0]!.facts).toHaveLength(1);
  });

  test("a first capture has no before and still counts", () => {
    const { stories } = buildCompetitorMemory(
      [row({ before: null, at: daysAgo(40) }), row({ at: daysAgo(2) })],
      { now: NOW },
    );
    expect(stories[0]!.facts[0]!.before).toBeNull();
    expect(memoryFactText(stories[0]!.facts[0]!)).toBe(
      "pricing: Standard · $79/mo (1 month ago)",
    );
  });

  test("summary line names the span and the volume", () => {
    const { stories } = buildCompetitorMemory(
      [row({ at: daysAgo(60) }), row({ at: daysAgo(2) })],
      { now: NOW },
    );
    expect(storySummary(stories[0]!)).toBe("Watched since Jun 14, 2026 · 2 changes");
  });

  test("an invalid timestamp is skipped rather than poisoning the order", () => {
    const { stories } = buildCompetitorMemory(
      [row({ at: "not-a-date" }), row({ at: daysAgo(5) }), row({ at: daysAgo(9) })],
      { now: NOW },
    );
    expect(stories[0]!.facts).toHaveLength(2);
  });
});
