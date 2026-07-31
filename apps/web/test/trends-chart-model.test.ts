import { test, expect, describe } from "bun:test";
import type { TrendsMarketSeries } from "../src/lib/api";
import {
  asOfKey,
  buildCarriedGrid,
  buildSlopeModel,
  decollide,
  rawKey,
} from "../src/components/dashboard/trends-chart-model";

function series(
  id: string,
  points: Array<[string, number]>,
  over: Partial<TrendsMarketSeries> = {},
): TrendsMarketSeries {
  return {
    competitorId: id,
    competitorName: id,
    competitorUrl: null,
    color: null,
    isSelf: false,
    unit: "USD",
    points: points.map(([t, value]) => ({ t, value })),
    ...over,
  };
}

const stamp = (iso: string) => new Date(iso).getTime();

describe("buildCarriedGrid", () => {
  // The bug this whole change exists for: competitors are scraped on staggered
  // days, so a row only held whoever reported that day, and the tooltip (which
  // reads the payload) named one competitor on a plot of twelve lines.
  test("every series carries a value at every row from its first capture on", () => {
    const grid = buildCarriedGrid(
      [
        series("a", [
          ["2026-05-01", 10],
          ["2026-05-20", 12],
        ]),
        series("b", [["2026-05-10", 99]]),
      ],
      "absolute",
    );

    expect(grid.rows.map((r) => r.t)).toEqual([
      stamp("2026-05-01"),
      stamp("2026-05-10"),
      stamp("2026-05-20"),
    ]);
    // `a` holds 10 through the 10th, then jumps on the day we read 12.
    expect(grid.rows.map((r) => r.a)).toEqual([10, 10, 12]);
    // `b` is carried forward past its only capture.
    expect(grid.rows[1]!.b).toBe(99);
    expect(grid.rows[2]!.b).toBe(99);
  });

  test("nothing is carried backward, so pre-coverage rows stay empty", () => {
    const grid = buildCarriedGrid(
      [series("a", [["2026-05-01", 10]]), series("b", [["2026-05-10", 99]])],
      "absolute",
    );
    expect(grid.rows[0]!.b).toBeUndefined();
    expect(grid.rows[0]!.a).toBe(10);
  });

  test("a carried reading states the date it was actually taken", () => {
    const grid = buildCarriedGrid(
      [
        series("a", [
          ["2026-05-01", 10],
          ["2026-05-20", 12],
        ]),
        series("b", [["2026-05-10", 99]]),
      ],
      "absolute",
    );
    // Rows 1 and 3 are fresh reads; row 2 points back at the capture it came from,
    // so the tooltip can say "as of May 1" instead of implying a re-measure.
    expect(grid.rows[0]![asOfKey("a")]).toBe(stamp("2026-05-01"));
    expect(grid.rows[1]![asOfKey("a")]).toBe(stamp("2026-05-01"));
    expect(grid.rows[2]![asOfKey("a")]).toBe(stamp("2026-05-20"));
  });

  test("index mode measures each series from its own first capture", () => {
    const grid = buildCarriedGrid(
      [
        series("a", [
          ["2026-05-01", 200],
          ["2026-05-20", 250],
        ]),
        series("b", [
          ["2026-05-10", 8],
          ["2026-05-20", 6],
        ]),
      ],
      "index",
    );
    expect(grid.rows[2]!.a).toBe(25);
    expect(grid.rows[2]!.b).toBe(-25);
    // The raw capture travels alongside, so the tooltip can print both.
    expect(grid.rows[2]![rawKey("a")]).toBe(250);
  });

  test("ticks span the real elapsed time, capped at six", () => {
    const points: Array<[string, number]> = Array.from({ length: 40 }, (_, i) => [
      `2026-05-${String(i + 1).padStart(2, "0")}T00:00:00`,
      i,
    ]).slice(0, 20);
    const grid = buildCarriedGrid([series("a", points)], "absolute");

    expect(grid.ticks).toHaveLength(6);
    expect(grid.ticks[0]).toBe(grid.rows[0]!.t);
    expect(grid.ticks[5]).toBe(grid.rows[grid.rows.length - 1]!.t);
    // Evenly spaced by TIME, which is the whole point: the old categorical axis
    // gave 27 days between captures the same width as one.
    const gaps = grid.ticks.slice(1).map((t, i) => t - grid.ticks[i]!);
    for (const gap of gaps) expect(Math.abs(gap - gaps[0]!)).toBeLessThanOrEqual(1);
  });

  test("an empty field produces no rows and no ticks", () => {
    const grid = buildCarriedGrid([], "absolute");
    expect(grid.rows).toEqual([]);
    expect(grid.ticks).toEqual([]);
    expect(grid.domain).toBeNull();
  });

  test("a window holding one captured day still gets a domain with width", () => {
    const grid = buildCarriedGrid([series("a", [["2026-05-01", 10]])], "absolute");
    const [lo, hi] = grid.domain!;
    expect(hi).toBeGreaterThan(lo);
    expect(lo).toBeLessThan(stamp("2026-05-01"));
    expect(hi).toBeGreaterThan(stamp("2026-05-01"));
  });
});

describe("decollide", () => {
  test("leaves labels that already clear the gap alone", () => {
    expect(decollide([10, 40, 70], 20, 200)).toEqual([10, 40, 70]);
  });

  test("pushes overlapping labels apart without reordering them", () => {
    expect(decollide([10, 12, 14], 20, 200)).toEqual([10, 30, 50]);
  });

  test("pulls a stack that overflowed the bottom back onto the plot", () => {
    const out = decollide([150, 155, 160], 20, 200);
    expect(out[2]).toBe(190);
    expect(out[1]).toBe(170);
    expect(out[0]).toBe(150);
  });
});

describe("buildSlopeModel", () => {
  test("returns null when nothing was captured", () => {
    expect(buildSlopeModel([])).toBeNull();
    expect(buildSlopeModel([series("a", [])])).toBeNull();
  });

  test("reads the endpoints and the percent between them", () => {
    const model = buildSlopeModel([
      series("mover", [
        ["2026-05-01", 29],
        ["2026-07-01", 35],
      ]),
      series("steady", [
        ["2026-05-01", 99],
        ["2026-07-01", 99],
      ]),
    ])!;

    const mover = model.rows.find((r) => r.item.competitorId === "mover")!;
    expect(mover.from).toBe(29);
    expect(mover.to).toBe(35);
    expect(mover.pct).toBe(20.7);
    expect(mover.moved).toBe(true);
    expect(model.movedCount).toBe(1);
    expect(model.rows.find((r) => r.item.competitorId === "steady")!.moved).toBe(false);
  });

  test("a single capture is flagged rather than sold as a flat trend", () => {
    const model = buildSlopeModel([series("once", [["2026-05-01", 29]])])!;
    expect(model.rows[0]!.single).toBe(true);
    expect(model.rows[0]!.moved).toBe(false);
    expect(model.singleCount).toBe(1);
  });

  test("movers paint last so they sit above the bundle they left", () => {
    const model = buildSlopeModel([
      series("mover", [
        ["2026-05-01", 29],
        ["2026-07-01", 35],
      ]),
      series("steady", [
        ["2026-05-01", 99],
        ["2026-07-01", 99],
      ]),
    ])!;
    expect(model.drawn[model.drawn.length - 1]!.item.competitorId).toBe("mover");
  });

  test("the axis takes the field's most common unit, not the first row's", () => {
    const model = buildSlopeModel([
      series("odd", [["2026-05-01", 10]], { unit: "EUR" }),
      series("a", [["2026-05-01", 20]], { unit: "USD" }),
      series("b", [["2026-05-01", 30]], { unit: "USD" }),
    ])!;
    expect(model.axisItem.unit).toBe("USD");
  });

  test("labels run top-down and never overlap", () => {
    const model = buildSlopeModel(
      Array.from({ length: 12 }, (_, i) =>
        series(`c${i}`, [
          ["2026-05-01", 20 + i * 0.1],
          ["2026-07-01", 20 + i * 0.1],
        ]),
      ),
    )!;

    const tops = model.labels.map((l) => l.top);
    for (let i = 1; i < tops.length; i++) {
      expect(tops[i]! - tops[i - 1]!).toBeGreaterThanOrEqual(19.99);
    }
    // The dots stay on the data even where the text had to be nudged.
    expect(model.y(model.labels[0]!.row.to)).toBeLessThan(
      model.y(model.labels[tops.length - 1]!.row.to),
    );
  });

  test("a field sitting at one price draws on the centre line instead of dividing by zero", () => {
    const model = buildSlopeModel([
      series("a", [["2026-05-01", 50]]),
      series("b", [["2026-05-01", 50]]),
    ])!;
    expect(Number.isFinite(model.y(50))).toBe(true);
    expect(model.y(50)).toBe(model.height / 2);
  });

  test("the window's endpoints come from the whole field, not one series", () => {
    const model = buildSlopeModel([
      series("late", [["2026-06-01", 10]]),
      series("early", [
        ["2026-05-01", 20],
        ["2026-07-01", 20],
      ]),
    ])!;
    expect(model.firstDate).toBe("2026-05-01");
    expect(model.lastDate).toBe("2026-07-01");
  });
});
