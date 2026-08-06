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

  // Dropping the one competitor that owns the top of the range is the reason to
  // offer a filter on a price chart: without the rescale, ten cheap plans stay
  // flattened onto the floor whether the expensive one is plotted or not.
  test("plotting fewer competitors rescales the ladder", () => {
    const cheap = series("cheap", [
      ["2026-05-01", 9],
      ["2026-07-01", 12],
    ]);
    const expensive = series("expensive", [
      ["2026-05-01", 499],
      ["2026-07-01", 499],
    ]);

    const withOutlier = buildSlopeModel([cheap, expensive])!;
    const without = buildSlopeModel([cheap])!;

    expect(withOutlier.ticks).not.toEqual(without.ticks);
    expect(Math.max(...withOutlier.ticks)).toBe(499);
    expect(Math.max(...without.ticks)).toBe(12);
    // The $3 the cheap plan moved was 0.6% of the old plot's height and is the whole
    // of the new one's.
    const travelled = (m: typeof without) => Math.abs(m.y(9) - m.y(12)) / m.height;
    expect(travelled(without)).toBeGreaterThan(travelled(withOutlier) * 10);
  });
});

describe("buildSlopeModel ladder trimming", () => {
  // A realistic seat-price field: six competitors between $8 and $13.49, one of
  // which moved, plus one competitor publishing an enterprise-only monthly number.
  const field = () => [
    series("linear", [
      ["2026-05-01", 8],
      ["2026-07-01", 8],
    ]),
    series("jira", [
      ["2026-05-01", 8.6],
      ["2026-07-01", 8.6],
    ]),
    series("asana", [
      ["2026-05-01", 10.99],
      ["2026-07-01", 13.49],
    ]),
    series("monday", [
      ["2026-05-01", 12],
      ["2026-07-01", 12],
    ]),
    series("notion", [
      ["2026-05-01", 10],
      ["2026-07-01", 10],
    ]),
    series("smartsheet", [
      ["2026-05-01", 9],
      ["2026-07-01", 9],
    ]),
  ];
  const enterprise = (price: number) =>
    series("enterprise", [
      ["2026-05-01", price],
      ["2026-07-01", price],
    ]);

  // The bug in one number. On the untrimmed ladder Asana's real +22.7% drew 0.9px
  // of travel, which is nothing — the whole plot was spent on the gap to $499.
  test("one enterprise plan no longer flattens the field it is plotted against", () => {
    const set = [...field(), enterprise(499)];
    const trimmed = buildSlopeModel(set)!;
    const full = buildSlopeModel(set, { full: true })!;

    const travel = (m: NonNullable<ReturnType<typeof buildSlopeModel>>) =>
      Math.abs(m.y(10.99) - m.y(13.49));
    expect(travel(full)).toBeLessThan(1);
    expect(travel(trimmed)).toBeGreaterThan(30);
    // The ladder stops at the top of the bundle, not at the outlier.
    expect(trimmed.max).toBe(13.49);
    expect(trimmed.fullMax).toBe(499);
  });

  test("the trim is counted and reversible, so the axis can say what it did", () => {
    const trimmed = buildSlopeModel([...field(), enterprise(499)])!;
    expect(trimmed.trimmable).toBe(true);
    expect(trimmed.clippedCount).toBe(1);
    expect(trimmed.outside(499)).toBe("above");
    expect(trimmed.outside(12)).toBeNull();

    const full = buildSlopeModel([...field(), enterprise(499)], { full: true })!;
    expect(full.max).toBe(499);
    expect(full.clippedCount).toBe(0);
    // The way back is still offered once taken, or the reader is stuck on the
    // scale they just asked to leave.
    expect(full.trimmable).toBe(true);
  });

  test("a price past the ladder is pinned to its edge, never drawn off the plot", () => {
    const model = buildSlopeModel([...field(), enterprise(2400)])!;
    expect(model.y(2400)).toBe(model.y(model.max));
    expect(model.y(2400)).toBeGreaterThanOrEqual(0);
  });

  test("a field with no outlier is left exactly as it was", () => {
    const model = buildSlopeModel(field())!;
    expect(model.trimmable).toBe(false);
    expect(model.clippedCount).toBe(0);
    expect(model.min).toBe(8);
    expect(model.max).toBe(13.49);
  });

  // Two prices are a spread, not an outlier: with nothing else on the ladder there
  // is no majority to call one of them wrong, so both stay and the page's own
  // competitor filter remains the way out.
  test("two competitors are never trimmed against each other", () => {
    const model = buildSlopeModel([
      series("cheap", [
        ["2026-05-01", 9],
        ["2026-07-01", 12],
      ]),
      enterprise(499),
    ])!;
    expect(model.trimmable).toBe(false);
    expect(model.max).toBe(499);
  });
});

describe("buildSlopeModel leaders", () => {
  test("a label pushed off its own line gets a pointer back to it", () => {
    // The shape the pointers exist for: a bundle of similar prices plus one
    // enterprise plan that stretches the scale, so the bundle's end dots land within
    // a pixel of each other and decollide has to move every one of their labels.
    // Read on the FULL ladder, which is the only way to still get that pile-up now
    // that the default one trims the outlier off.
    const bundle = Array.from({ length: 5 }, (_, i) =>
      series(`c${i}`, [
        ["2026-05-01", 10 + i * 0.1],
        ["2026-07-01", 10 + i * 0.1],
      ]),
    );
    const model = buildSlopeModel(
      [
        ...bundle,
        series("enterprise", [
          ["2026-05-01", 500],
          ["2026-07-01", 500],
        ]),
      ],
      { full: true },
    )!;

    expect(model.leaders.length).toBe(bundle.length);
    // The outlier's label never moved, so it is not pointed at.
    expect(model.leaders.some((l) => l.competitorId === "enterprise")).toBe(false);

    for (const leader of model.leaders) {
      const label = model.labels.find((l) => l.row.item.competitorId === leader.competitorId);
      expect(leader.labelY).toBe(label!.top);
      // The pointer starts on the data, never on the label's nudged position.
      expect(leader.endY).toBe(model.y(label!.row.to));
    }
  });

  test("labels that already sit on their line get no pointer", () => {
    // Far enough apart that decollide leaves both alone — a leader here would point
    // at the label it is already touching.
    const model = buildSlopeModel([
      series("high", [
        ["2026-05-01", 400],
        ["2026-07-01", 400],
      ]),
      series("low", [
        ["2026-05-01", 10],
        ["2026-07-01", 10],
      ]),
    ])!;

    expect(model.leaders).toEqual([]);
  });
});
