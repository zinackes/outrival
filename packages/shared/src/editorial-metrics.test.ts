import { test, expect, describe } from "bun:test";
import {
  normalizeTopic,
  itemDate,
  topicDistribution,
  jensenShannonDivergence,
  risingDeclining,
  cadenceByMonth,
  editorialWindows,
  detectEditorialPivot,
  topTopics,
  monthKey,
  EDITORIAL_PIVOT_DIVERGENCE,
  type EditorialItem,
} from "./editorial-metrics";

const NOW = new Date("2026-08-01T00:00:00Z");
const DAY = 86_400_000;

/** An item `daysAgo` before NOW. `topics: null` is a post nobody has read. */
function post(
  daysAgo: number,
  topics: string[] | null,
  extra: Partial<EditorialItem> = {},
): EditorialItem {
  const at = new Date(NOW.getTime() - daysAgo * DAY);
  return {
    sourceType: "blog",
    itemType: topics ? "thought_leadership" : null,
    topics,
    publishedAt: at,
    firstSeenAt: at,
    ...extra,
  };
}

/** `n` posts spread inside the window that starts `fromDaysAgo` days back. */
function posts(n: number, fromDaysAgo: number, topics: string[]): EditorialItem[] {
  return Array.from({ length: n }, (_, i) => post(fromDaysAgo + i, topics));
}

describe("normalizeTopic", () => {
  test("lowercases and collapses whitespace", () => {
    expect(normalizeTopic("  AI   Agents ")).toBe("ai agents");
  });

  test("does not stem or merge near-identical topics", () => {
    // Deciding "ai agent" and "ai agents" are one topic is a judgement, and a
    // wrong merge silently changes a distribution nobody can audit.
    expect(normalizeTopic("ai agent")).not.toBe(normalizeTopic("ai agents"));
  });
});

describe("itemDate", () => {
  test("prefers what the publisher stated", () => {
    const at = itemDate({
      sourceType: "blog",
      itemType: null,
      topics: null,
      publishedAt: new Date("2026-05-01T00:00:00Z"),
      firstSeenAt: new Date("2026-07-01T00:00:00Z"),
    });
    expect(at.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  test("falls back to first seen when the source dates nothing", () => {
    const at = itemDate({
      sourceType: "roadmap",
      itemType: null,
      topics: null,
      publishedAt: null,
      firstSeenAt: new Date("2026-07-01T00:00:00Z"),
    });
    expect(at.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  test("accepts ISO strings, which is what the driver hands back", () => {
    const at = itemDate({
      sourceType: "blog",
      itemType: null,
      topics: null,
      publishedAt: "2026-06-15T12:00:00Z",
      firstSeenAt: "2026-06-20T00:00:00Z",
    });
    expect(at.toISOString()).toBe("2026-06-15T12:00:00.000Z");
  });
});

describe("topicDistribution", () => {
  const window = { start: new Date(NOW.getTime() - 30 * DAY), end: NOW };

  test("counts posts and their topics inside the window only", () => {
    const d = topicDistribution(
      [post(5, ["ai agents"]), post(10, ["ai agents", "security"]), post(80, ["seo"])],
      window,
    );
    expect(d.posts).toBe(2);
    expect(d.counts).toEqual({ "ai agents": 2, security: 1 });
    expect(d.total).toBe(3);
  });

  test("a topic repeated within one post counts once", () => {
    const d = topicDistribution([post(1, ["AI Agents", "ai agents", " ai  agents "])], window);
    expect(d.counts).toEqual({ "ai agents": 1 });
    expect(d.total).toBe(1);
  });

  test("an unread post counts as a post and contributes no topic", () => {
    const d = topicDistribution([post(1, null), post(2, ["security"])], window);
    expect(d.posts).toBe(2);
    expect(d.total).toBe(1);
  });

  test("empty topic strings are dropped", () => {
    const d = topicDistribution([post(1, ["", "   ", "security"])], window);
    expect(d.counts).toEqual({ security: 1 });
  });

  test("the window is half-open: start is in, end is out", () => {
    const atStart: EditorialItem = {
      sourceType: "blog",
      itemType: null,
      topics: ["a"],
      publishedAt: window.start,
      firstSeenAt: window.start,
    };
    const atEnd: EditorialItem = { ...atStart, publishedAt: window.end, firstSeenAt: window.end };
    expect(topicDistribution([atStart], window).posts).toBe(1);
    expect(topicDistribution([atEnd], window).posts).toBe(0);
  });

  test("an unparseable date is dropped rather than counted as epoch", () => {
    const bad: EditorialItem = {
      sourceType: "blog",
      itemType: null,
      topics: ["a"],
      publishedAt: "not a date",
      firstSeenAt: "also not a date",
    };
    expect(topicDistribution([bad], window).posts).toBe(0);
  });

  test("no items is a zero distribution, not a throw", () => {
    expect(topicDistribution([], window)).toEqual({ posts: 0, counts: {}, total: 0 });
  });
});

describe("jensenShannonDivergence", () => {
  const dist = (counts: Record<string, number>) => ({
    posts: Object.values(counts).reduce((a, b) => a + b, 0),
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  });

  test("identical distributions diverge by zero", () => {
    const d = dist({ a: 3, b: 1 });
    expect(jensenShannonDivergence(d, d)).toBe(0);
  });

  test("same shape at a different scale still diverges by zero", () => {
    // The whole reason this is a distance between shapes: publishing twice as much
    // about the same things is not a pivot.
    expect(jensenShannonDivergence(dist({ a: 3, b: 1 }), dist({ a: 30, b: 10 }))).toBeCloseTo(0, 10);
  });

  test("fully disjoint topics diverge by one, in base 2", () => {
    expect(jensenShannonDivergence(dist({ a: 5 }), dist({ b: 5 }))).toBeCloseTo(1, 10);
  });

  test("is symmetric", () => {
    const p = dist({ a: 4, b: 1, c: 1 });
    const q = dist({ a: 1, b: 4, d: 2 });
    expect(jensenShannonDivergence(p, q)).toBeCloseTo(jensenShannonDivergence(q, p)!, 12);
  });

  test("stays inside [0, 1]", () => {
    const v = jensenShannonDivergence(dist({ a: 7, b: 2, c: 1 }), dist({ c: 4, d: 9 }));
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  test("null when either side holds no topic at all", () => {
    // Not 0 ("nothing changed") and not 1 ("everything changed") — neither is true
    // of a window that said nothing.
    expect(jensenShannonDivergence(dist({}), dist({ a: 3 }))).toBeNull();
    expect(jensenShannonDivergence(dist({ a: 3 }), dist({}))).toBeNull();
    expect(jensenShannonDivergence(dist({}), dist({}))).toBeNull();
  });

  test("half the mass moving to new topics lands well above the threshold", () => {
    const before = dist({ onboarding: 5, seo: 5 });
    const after = dist({ onboarding: 2, seo: 1, "ai agents": 5, security: 4 });
    expect(jensenShannonDivergence(before, after)!).toBeGreaterThan(EDITORIAL_PIVOT_DIVERGENCE);
  });

  test("one extra post on an existing theme stays well below the threshold", () => {
    const before = dist({ onboarding: 4, seo: 3, api: 3 });
    const after = dist({ onboarding: 5, seo: 3, api: 3 });
    expect(jensenShannonDivergence(before, after)!).toBeLessThan(EDITORIAL_PIVOT_DIVERGENCE);
  });
});

describe("risingDeclining", () => {
  const previous = { posts: 9, counts: { onboarding: 4, seo: 3, api: 2 }, total: 9 };
  const current = { posts: 13, counts: { "ai agents": 6, security: 4, api: 2, onboarding: 1 }, total: 13 };

  test("names what gained and what lost", () => {
    const { rising, declining } = risingDeclining(previous, current);
    expect(rising.map((r) => r.topic)).toEqual(["ai agents", "security"]);
    // `api` holds the same 2 posts in both windows, so it takes a smaller share of
    // the bigger one and declines. That is the share ranking, not a bug.
    expect(declining.map((d) => d.topic)).toEqual(["onboarding", "seo", "api"]);
  });

  test("carries both counts so the block can print them", () => {
    const { rising } = risingDeclining(previous, current);
    expect(rising[0]).toMatchObject({ topic: "ai agents", now: 6, then: 0 });
  });

  test("ranks by share, so publishing more does not make everything rise", () => {
    // `api` holds the same 2 posts in both windows but a SMALLER share of the
    // larger one, so it is not rising.
    const { rising } = risingDeclining(previous, current);
    expect(rising.map((r) => r.topic)).not.toContain("api");
  });

  test("a single post's tag cannot be a trend", () => {
    const { rising } = risingDeclining(
      { posts: 8, counts: { onboarding: 8 }, total: 8 },
      { posts: 8, counts: { onboarding: 7, "one off": 1 }, total: 8 },
    );
    expect(rising).toEqual([]);
  });

  test("minCount is configurable, and 1 lets the one-off through", () => {
    const { rising } = risingDeclining(
      { posts: 8, counts: { onboarding: 8 }, total: 8 },
      { posts: 8, counts: { onboarding: 7, "one off": 1 }, total: 8 },
      { minCount: 1 },
    );
    expect(rising.map((r) => r.topic)).toEqual(["one off"]);
  });

  test("respects the limit", () => {
    const { rising } = risingDeclining(
      { posts: 4, counts: { old: 4 }, total: 4 },
      { posts: 8, counts: { a: 2, b: 2, c: 2, d: 2 }, total: 8 },
      { limit: 2 },
    );
    expect(rising).toHaveLength(2);
  });

  test("empty windows return empty lists rather than throwing", () => {
    const empty = { posts: 0, counts: {}, total: 0 };
    expect(risingDeclining(empty, empty)).toEqual({ rising: [], declining: [] });
  });
});

describe("cadenceByMonth", () => {
  test("is dense and ascending, and ends on the month `through` falls in", () => {
    const series = cadenceByMonth([], { months: 3, through: NOW });
    expect(series.map((s) => s.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  test("splits each month by source", () => {
    const series = cadenceByMonth(
      [
        post(40, null, { sourceType: "changelog" }),
        post(40, null, { sourceType: "changelog" }),
        post(40, null, { sourceType: "blog" }),
      ],
      { months: 3, through: NOW },
    );
    const june = series.find((s) => s.month === "2026-06")!;
    expect(june).toMatchObject({ total: 3, bySource: { changelog: 2, blog: 1 } });
  });

  test("a month with nothing published is a real zero, not a gap", () => {
    // Two days before 2026-08-01 is July, so June and August are genuine zeros.
    const series = cadenceByMonth([post(2, null)], { months: 3, through: NOW });
    expect(series.map((s) => s.total)).toEqual([0, 1, 0]);
  });

  test("marks the running month, and only it", () => {
    const series = cadenceByMonth([], { months: 4, through: NOW });
    expect(series.filter((s) => s.partial).map((s) => s.month)).toEqual(["2026-08"]);
  });

  test("items outside the span are ignored", () => {
    const series = cadenceByMonth([post(400, null)], { months: 3, through: NOW });
    expect(series.reduce((n, s) => n + s.total, 0)).toBe(0);
  });

  test("crosses a year boundary correctly", () => {
    const series = cadenceByMonth([], { months: 3, through: new Date("2026-01-15T00:00:00Z") });
    expect(series.map((s) => s.month)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
});

describe("monthKey", () => {
  test("pads the month", () => {
    expect(monthKey(new Date("2026-03-09T00:00:00Z"))).toBe("2026-03");
  });
});

describe("editorialWindows", () => {
  test("two adjacent 90-day windows, current ending now", () => {
    const { current, previous } = editorialWindows(NOW);
    expect(current.end).toEqual(NOW);
    expect(current.start.getTime()).toBe(NOW.getTime() - 90 * DAY);
    expect(previous.end.getTime()).toBe(current.start.getTime());
    expect(previous.start.getTime()).toBe(NOW.getTime() - 180 * DAY);
  });
});

describe("detectEditorialPivot", () => {
  /** 8 read posts per window, 5 distinct topics, distributions fully disjoint. */
  const CURRENT = [...posts(4, 5, ["ai agents"]), ...posts(4, 20, ["security", "ai agents"])];
  const PREVIOUS = [
    ...posts(4, 95, ["onboarding"]),
    ...posts(4, 120, ["seo", "developer experience"]),
  ];
  const pivoting = (): EditorialItem[] => [...CURRENT, ...PREVIOUS];

  test("fires when every condition holds", () => {
    const pivot = detectEditorialPivot(pivoting(), { now: NOW });
    expect(pivot).not.toBeNull();
    expect(pivot!.divergence).toBeGreaterThanOrEqual(EDITORIAL_PIVOT_DIVERGENCE);
    expect(pivot!.current.posts).toBe(8);
    expect(pivot!.previous.posts).toBe(8);
    expect(pivot!.rising.map((r) => r.topic)).toContain("ai agents");
    expect(pivot!.declining.map((d) => d.topic)).toContain("onboarding");
  });

  test("seven posts in a window is not enough — a small blog cannot pivot", () => {
    // The same pivoting set with one current-window post removed: only the floor
    // changed, so only the floor can be what stopped it.
    const items = [...CURRENT.slice(1), ...PREVIOUS];
    expect(topicDistribution(items, editorialWindows(NOW).current).posts).toBe(7);
    expect(detectEditorialPivot(items, { now: NOW })).toBeNull();
  });

  test("seven posts in the PREVIOUS window is not enough either", () => {
    const items = [...CURRENT, ...PREVIOUS.slice(1)];
    expect(topicDistribution(items, editorialWindows(NOW).previous).posts).toBe(7);
    expect(detectEditorialPivot(items, { now: NOW })).toBeNull();
  });

  test("unread posts do not fill a window", () => {
    // Eight posts either side, but half of them were never opened, so the topic
    // shapes rest on four posts each. The floor counts posts, and an unread post
    // is a post — this is the case the floor is really guarding.
    const items = [
      ...posts(8, 5, ["ai agents"]),
      ...posts(8, 95, ["onboarding"]),
    ].map((p, i) => (i % 2 === 0 ? p : { ...p, topics: null }));
    const pivot = detectEditorialPivot(items, { now: NOW });
    // Posts clear the floor; topic breadth does not.
    expect(pivot).toBeNull();
  });

  test("four distinct topics across both windows is not a pivot", () => {
    const items = [
      ...posts(8, 5, ["ai agents", "security"]),
      ...posts(8, 95, ["onboarding", "seo"]),
    ];
    expect(detectEditorialPivot(items, { now: NOW })).toBeNull();
    // The same items with one more subject do clear it.
    const wider = [...items, ...posts(1, 6, ["pricing"])];
    expect(detectEditorialPivot(wider, { now: NOW })).not.toBeNull();
  });

  test("a blog writing about the same things does not pivot, however much it publishes", () => {
    const items = [
      ...posts(10, 5, ["onboarding", "seo", "api", "pricing", "security"]),
      ...posts(9, 95, ["onboarding", "seo", "api", "pricing", "security"]),
    ];
    expect(detectEditorialPivot(items, { now: NOW })).toBeNull();
  });

  test("a divergence just under the threshold does not fire", () => {
    const items = pivoting();
    const measured = detectEditorialPivot(items, { now: NOW })!.divergence;
    expect(detectEditorialPivot(items, { now: NOW, threshold: measured + 0.0001 })).toBeNull();
  });

  test("posts older than both windows are invisible to it", () => {
    const items = [...pivoting(), ...posts(20, 400, ["ancient history"])];
    const pivot = detectEditorialPivot(items, { now: NOW })!;
    expect(Object.keys(pivot.previous.counts)).not.toContain("ancient history");
  });

  test("no items at all returns null rather than throwing", () => {
    expect(detectEditorialPivot([], { now: NOW })).toBeNull();
  });
});

describe("topTopics", () => {
  test("returns the biggest first, capped", () => {
    const d = { posts: 6, counts: { a: 3, b: 2, c: 1 }, total: 6 };
    expect(topTopics(d, 2)).toEqual([
      { topic: "a", count: 3 },
      { topic: "b", count: 2 },
    ]);
  });

  test("ties break alphabetically so the block is stable between runs", () => {
    const d = { posts: 4, counts: { zeta: 2, alpha: 2 }, total: 4 };
    expect(topTopics(d).map((t) => t.topic)).toEqual(["alpha", "zeta"]);
  });

  test("an empty distribution yields an empty list", () => {
    expect(topTopics({ posts: 0, counts: {}, total: 0 })).toEqual([]);
  });
});
