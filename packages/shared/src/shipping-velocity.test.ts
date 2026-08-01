import { describe, expect, test } from "bun:test";
import { summarizeShipping, MIN_SHIPPING_MONTHS } from "./shipping-velocity";

// Fixed "now": mid-month, so the running month is unmistakably incomplete.
const NOW = new Date("2026-08-14T10:00:00Z");

describe("summarizeShipping — what counts", () => {
  test("averages the last three COMPLETE months", () => {
    const s = summarizeShipping(
      [
        { month: "2026-05", count: 3 },
        { month: "2026-06", count: 6 },
        { month: "2026-07", count: 9 },
      ],
      NOW,
    );
    expect(s?.perMonth).toBe(6);
  });

  test("the running month is never averaged in", () => {
    // Two entries so far in August would drag a 9-a-month competitor to 6.7.
    const s = summarizeShipping(
      [
        { month: "2026-06", count: 9 },
        { month: "2026-07", count: 9 },
        { month: "2026-08", count: 2 },
      ],
      NOW,
    );
    expect(s?.perMonth).toBe(9);
    expect(s?.months.map((m) => m.month)).not.toContain("2026-08");
  });

  test("a month with no entries inside the observed span counts as zero", () => {
    const s = summarizeShipping(
      [
        { month: "2026-05", count: 6 },
        { month: "2026-07", count: 3 },
      ],
      NOW,
    );
    // May, June (silent), July → 3.
    expect(s?.perMonth).toBe(3);
    expect(s?.months.find((m) => m.month === "2026-06")?.count).toBe(0);
  });

  test("months before the first entry we hold are ABSENT, not zero", () => {
    const s = summarizeShipping(
      [
        { month: "2026-06", count: 4 },
        { month: "2026-07", count: 4 },
      ],
      NOW,
    );
    // Six bars are asked for; only the two observed months exist.
    expect(s?.months.map((m) => m.month)).toEqual(["2026-06", "2026-07"]);
    // And they are not diluted by four imaginary silent months.
    expect(s?.perMonth).toBe(4);
  });
});

describe("summarizeShipping — the floor", () => {
  test("under two complete months there is no reading at all", () => {
    const s = summarizeShipping([{ month: "2026-07", count: 12 }], NOW);
    expect(s).toBeNull();
    expect(MIN_SHIPPING_MONTHS).toBe(2);
  });

  test("a competitor tracked only this month is absent, not '12 a month'", () => {
    expect(summarizeShipping([{ month: "2026-08", count: 12 }], NOW)).toBeNull();
  });

  test("no rows at all is absent", () => {
    expect(summarizeShipping([], NOW)).toBeNull();
  });

  test("exactly two complete months reads", () => {
    const s = summarizeShipping(
      [
        { month: "2026-06", count: 2 },
        { month: "2026-07", count: 4 },
      ],
      NOW,
    );
    expect(s?.monthsObserved).toBe(2);
    expect(s?.perMonth).toBe(3);
  });
});

describe("summarizeShipping — the arrow", () => {
  test("a previous window with two observed months gives a comparison", () => {
    const s = summarizeShipping(
      [
        { month: "2026-03", count: 1 },
        { month: "2026-04", count: 1 },
        { month: "2026-05", count: 6 },
        { month: "2026-06", count: 6 },
        { month: "2026-07", count: 6 },
      ],
      NOW,
    );
    expect(s?.perMonth).toBe(6);
    // Feb is before the first entry we hold, so the baseline is March + April.
    expect(s?.previousPerMonth).toBe(1);
  });

  test("one observed month behind is not a baseline — no arrow", () => {
    const s = summarizeShipping(
      [
        { month: "2026-04", count: 1 },
        { month: "2026-05", count: 6 },
        { month: "2026-06", count: 6 },
        { month: "2026-07", count: 6 },
      ],
      NOW,
    );
    expect(s?.previousPerMonth).toBeNull();
  });

  test("a competitor with only the recent window has no arrow", () => {
    const s = summarizeShipping(
      [
        { month: "2026-06", count: 5 },
        { month: "2026-07", count: 5 },
      ],
      NOW,
    );
    expect(s?.previousPerMonth).toBeNull();
  });
});

describe("summarizeShipping — the bars", () => {
  test("at most six months, oldest first, ending on the last complete one", () => {
    const rows = [
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
    ].map((month) => ({ month, count: 1 }));
    const s = summarizeShipping(rows, NOW);
    expect(s?.months.map((m) => m.month)).toEqual([
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
    ]);
  });

  test("a year boundary is crossed correctly", () => {
    const s = summarizeShipping(
      [
        { month: "2025-11", count: 2 },
        { month: "2025-12", count: 2 },
        { month: "2026-01", count: 2 },
      ],
      new Date("2026-02-03T00:00:00Z"),
    );
    expect(s?.months.map((m) => m.month)).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(s?.perMonth).toBe(2);
  });
});
