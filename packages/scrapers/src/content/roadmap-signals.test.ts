import { test, expect, describe } from "bun:test";
import {
  planTopRequestSignal,
  rankOpenRequests,
  TOP_REQUEST_HIGH_VOTES,
  TOP_REQUEST_MIN_VOTES,
  type RoadmapEntryState,
  type RoadmapMove,
} from "./roadmap-signals";

const entry = (
  itemId: string,
  votes: number | null,
  status: RoadmapEntryState["status"] = "under_review",
): RoadmapEntryState => ({ itemId, title: `Request ${itemId}`, url: `https://x.test/${itemId}`, votes, status });

const move = (
  itemId: string,
  toStatus: RoadmapMove["toStatus"],
  fromStatus: RoadmapMove["fromStatus"] = "under_review",
): RoadmapMove => ({ itemId, fromStatus, toStatus, fromRaw: "Under review", toRaw: "Planned" });

describe("rankOpenRequests", () => {
  test("orders open entries by votes, highest first", () => {
    const ranked = rankOpenRequests([entry("a", 10), entry("b", 90), entry("c", 40)]);
    expect(ranked.map((e) => e.itemId)).toEqual(["b", "c", "a"]);
  });

  test("delivered and closed entries leave the ranking", () => {
    const ranked = rankOpenRequests([
      entry("shipped", 900, "delivered"),
      entry("dead", 800, "closed"),
      entry("live", 10, "planned"),
    ]);
    expect(ranked.map((e) => e.itemId)).toEqual(["live"]);
  });

  test("an entry with no published count has no position at all", () => {
    const ranked = rankOpenRequests([entry("counted", 5), entry("uncounted", null)]);
    expect(ranked.map((e) => e.itemId)).toEqual(["counted"]);
  });

  test("ties break on id, so a rank cannot reshuffle between captures", () => {
    const first = rankOpenRequests([entry("b", 20), entry("a", 20)]);
    const second = rankOpenRequests([entry("a", 20), entry("b", 20)]);
    expect(first.map((e) => e.itemId)).toEqual(second.map((e) => e.itemId));
  });
});

describe("planTopRequestSignal — the bar", () => {
  const portal = [
    entry("top", 142, "planned"),
    entry("second", 90),
    entry("third", 60),
    entry("fourth", 55),
  ];

  test("a top-3 request moving into planned fires", () => {
    const plan = planTopRequestSignal({
      moves: [move("top", "planned")],
      entries: portal,
      cooledDown: new Set(),
    });
    expect(plan?.primary.itemId).toBe("top");
    expect(plan?.primary.rank).toBe(1);
    expect(plan?.primary.votes).toBe(142);
  });

  test("rank 4 does not, however many votes it has", () => {
    const plan = planTopRequestSignal({
      moves: [move("fourth", "planned")],
      entries: portal,
      cooledDown: new Set(),
    });
    expect(plan).toBeNull();
  });

  test("a portal whose #1 has six votes never signals — that is a silent portal, not demand", () => {
    const quiet = [entry("a", 6, "planned"), entry("b", 3), entry("c", 1)];
    const plan = planTopRequestSignal({
      moves: [move("a", "planned")],
      entries: quiet,
      cooledDown: new Set(),
    });
    expect(plan).toBeNull();
    expect(TOP_REQUEST_MIN_VOTES).toBeGreaterThan(6);
  });

  test("exactly at the vote floor, it fires", () => {
    const atFloor = [entry("a", TOP_REQUEST_MIN_VOTES, "planned"), entry("b", 3)];
    const plan = planTopRequestSignal({
      moves: [move("a", "planned")],
      entries: atFloor,
      cooledDown: new Set(),
    });
    expect(plan?.primary.votes).toBe(TOP_REQUEST_MIN_VOTES);
  });

  test("a move that is not a commitment is not news", () => {
    for (const to of ["under_review", "closed", "delivered", "other"] as const) {
      const plan = planTopRequestSignal({
        moves: [{ ...move("top", to), toRaw: to }],
        entries: portal,
        cooledDown: new Set(),
      });
      expect(plan).toBeNull();
    }
  });

  test("in progress counts as a commitment too", () => {
    const plan = planTopRequestSignal({
      moves: [{ ...move("top", "in_progress", "planned"), toRaw: "In progress" }],
      entries: [entry("top", 142, "in_progress"), entry("second", 90)],
      cooledDown: new Set(),
    });
    expect(plan?.primary.toRaw).toBe("In progress");
  });

  test("an entry inside its cooldown stays quiet — statuses flap", () => {
    const plan = planTopRequestSignal({
      moves: [move("top", "planned")],
      entries: portal,
      cooledDown: new Set(["top"]),
    });
    expect(plan).toBeNull();
  });

  test("an entry with no vote count cannot be a top request", () => {
    const plan = planTopRequestSignal({
      moves: [move("mystery", "planned")],
      entries: [entry("mystery", null, "planned"), entry("a", 5)],
      cooledDown: new Set(),
    });
    expect(plan).toBeNull();
  });

  test("no moves, no signal", () => {
    expect(planTopRequestSignal({ moves: [], entries: portal, cooledDown: new Set() })).toBeNull();
  });
});

describe("planTopRequestSignal — severity", () => {
  test("#1 with real support behind it is high", () => {
    const plan = planTopRequestSignal({
      moves: [move("top", "planned")],
      entries: [entry("top", TOP_REQUEST_HIGH_VOTES, "planned"), entry("b", 10)],
      cooledDown: new Set(),
    });
    expect(plan?.primary.severity).toBe("high");
  });

  test("#1 just over the floor is medium — it leads a quiet portal", () => {
    const plan = planTopRequestSignal({
      moves: [move("top", "planned")],
      entries: [entry("top", 20, "planned"), entry("b", 10)],
      cooledDown: new Set(),
    });
    expect(plan?.primary.severity).toBe("medium");
  });

  test("#2 is medium however many votes it carries", () => {
    const plan = planTopRequestSignal({
      moves: [move("second", "planned")],
      entries: [entry("first", 900), entry("second", 800, "planned")],
      cooledDown: new Set(),
    });
    expect(plan?.primary.rank).toBe(2);
    expect(plan?.primary.severity).toBe("medium");
  });
});

describe("planTopRequestSignal — two moves in one capture", () => {
  test("the best-ranked leads and the other is named beside it, never raised twice", () => {
    const plan = planTopRequestSignal({
      moves: [move("second", "planned"), move("top", "planned")],
      entries: [entry("top", 142, "planned"), entry("second", 90, "planned"), entry("c", 5)],
      cooledDown: new Set(),
    });
    expect(plan?.primary.itemId).toBe("top");
    expect(plan?.alsoMoved.map((m) => m.itemId)).toEqual(["second"]);
  });
});
