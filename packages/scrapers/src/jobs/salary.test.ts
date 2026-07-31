import { test, expect, describe } from "bun:test";
import {
  tallySalaryBands,
  detectSalaryBandShift,
  disclosureVerdict,
  wasActiveInWeek,
  weeksBack,
  salaryBandKey,
  type SalaryTallyInput,
  type SalaryBandSeries,
} from "./salary";

const posting = (over: Partial<SalaryTallyInput> = {}): SalaryTallyInput => ({
  department: "Engineering",
  title: "Backend Engineer",
  salaryMin: 60_000,
  salaryMax: 80_000,
  salaryCurrency: "EUR",
  salaryPeriod: "yearly",
  ...over,
});

describe("tallySalaryBands", () => {
  test("computes p25/p50/p75 and n over one bucket and one currency", () => {
    const bands = tallySalaryBands([
      posting({ salaryMin: 50_000, salaryMax: 50_000 }),
      posting({ salaryMin: 60_000, salaryMax: 60_000 }),
      posting({ salaryMin: 70_000, salaryMax: 70_000 }),
      posting({ salaryMin: 80_000, salaryMax: 80_000 }),
    ]);
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({
      bucket: "engineering",
      currency: "EUR",
      p25: 57_500,
      p50: 65_000,
      p75: 72_500,
      n: 4,
    });
  });

  test("splits by currency and NEVER merges them", () => {
    const bands = tallySalaryBands([
      posting({ salaryMin: 60_000, salaryMax: 60_000, salaryCurrency: "EUR" }),
      posting({ salaryMin: 62_000, salaryMax: 62_000, salaryCurrency: "EUR" }),
      posting({ salaryMin: 150_000, salaryMax: 150_000, salaryCurrency: "USD" }),
    ]);
    expect(bands.map((b) => `${b.currency}:${b.n}`).sort()).toEqual(["EUR:2", "USD:1"]);
    // No band spans both, so no median ever sits between a euro and a dollar.
    expect(bands.every((b) => b.p50 === b.p25 || b.currency === "EUR")).toBe(true);
  });

  test("splits by department bucket", () => {
    const bands = tallySalaryBands([
      posting({ department: "Engineering" }),
      posting({ department: "Sales", title: "Account Executive" }),
    ]);
    expect(bands.map((b) => b.bucket).sort()).toEqual(["engineering", "sales"]);
  });

  test("drops the unknown bucket — a median for 'unknown' is unactionable", () => {
    const bands = tallySalaryBands([
      posting({ department: "Sonstiges", title: "Mitarbeiter*in" }),
    ]);
    expect(bands).toHaveLength(0);
  });

  test("hourly roles never reach a band, and are not counted in n", () => {
    const bands = tallySalaryBands([
      posting({ salaryMin: 60_000, salaryMax: 60_000 }),
      posting({ salaryMin: 70_000, salaryMax: 70_000 }),
      posting({ salaryMin: 45, salaryMax: 60, salaryPeriod: "hourly" }),
    ]);
    expect(bands[0]?.n).toBe(2);
    expect(bands[0]?.p50).toBe(65_000);
  });

  test("monthly postings annualise into the same band as yearly ones", () => {
    const bands = tallySalaryBands([
      posting({ salaryMin: 60_000, salaryMax: 60_000, salaryPeriod: "yearly" }),
      posting({ salaryMin: 5_000, salaryMax: 5_000, salaryPeriod: "monthly" }),
    ]);
    expect(bands[0]?.n).toBe(2);
    expect(bands[0]?.p50).toBe(60_000);
  });

  test("junk ranges are excluded rather than banded", () => {
    const bands = tallySalaryBands([
      posting({ salaryMin: 0, salaryMax: 1 }),
      posting({ salaryMin: 120_000, salaryMax: 80_000 }),
      posting({ salaryMin: 70_000, salaryMax: 70_000 }),
    ]);
    expect(bands[0]?.n).toBe(1);
  });

  test("a board with no disclosed pay yields no bands at all", () => {
    const bands = tallySalaryBands([
      posting({ salaryMin: null, salaryMax: null }),
      posting({ salaryMin: null, salaryMax: null, department: "Sales" }),
    ]);
    expect(bands).toEqual([]);
  });

  test("salaryBandKey is the (bucket, currency) pair, not the bucket alone", () => {
    expect(salaryBandKey("engineering", "EUR")).not.toBe(salaryBandKey("engineering", "USD"));
  });
});

// ── inflection ──────────────────────────────────────────────────────────────

const series = (points: Array<[string, number, number]>): SalaryBandSeries => ({
  bucket: "engineering",
  currency: "EUR",
  points: points.map(([weekStart, p50, n]) => ({ weekStart, p50, n })),
});

const W = ["2026-06-29", "2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"] as const;

describe("detectSalaryBandShift", () => {
  test("fires when p50 moves past +15% of the trailing median", () => {
    const firing = detectSalaryBandShift(
      [
        series([
          [W[0], 68_000, 6],
          [W[1], 68_000, 6],
          [W[2], 68_000, 6],
          [W[3], 68_000, 6],
          [W[4], 79_000, 6],
        ]),
      ],
      W[4],
    );
    expect(firing).toHaveLength(1);
    expect(firing[0]?.baseline).toBe(68_000);
    expect(firing[0]?.current.p50).toBe(79_000);
    expect(firing[0]?.delta).toBeCloseTo(0.1617, 3);
    expect(firing[0]?.trailing).toHaveLength(4);
  });

  test("fires on a cut too — a downward move is the same news", () => {
    const firing = detectSalaryBandShift(
      [
        series([
          [W[1], 80_000, 5],
          [W[2], 80_000, 5],
          [W[3], 80_000, 5],
          [W[4], 60_000, 5],
        ]),
      ],
      W[4],
    );
    expect(firing[0]?.delta).toBeLessThan(0);
  });

  test("stays silent inside the band", () => {
    const firing = detectSalaryBandShift(
      [
        series([
          [W[1], 70_000, 5],
          [W[2], 70_000, 5],
          [W[3], 70_000, 5],
          [W[4], 76_000, 5],
        ]),
      ],
      W[4],
    );
    expect(firing).toEqual([]);
  });

  test("needs n>=3 on the CURRENT week", () => {
    const firing = detectSalaryBandShift(
      [
        series([
          [W[1], 68_000, 6],
          [W[2], 68_000, 6],
          [W[3], 68_000, 6],
          [W[4], 90_000, 2],
        ]),
      ],
      W[4],
    );
    expect(firing).toEqual([]);
  });

  test("needs n>=3 on the trailing side, and enough qualifying weeks", () => {
    const firing = detectSalaryBandShift(
      [
        series([
          [W[1], 68_000, 1],
          [W[2], 68_000, 2],
          [W[3], 68_000, 6],
          [W[4], 90_000, 6],
        ]),
      ],
      W[4],
    );
    // Only one trailing week clears n>=3, so there is no baseline to speak of.
    expect(firing).toEqual([]);
  });

  test("a stale series cannot fire — the last point must BE the current week", () => {
    const firing = detectSalaryBandShift(
      [
        series([
          [W[0], 68_000, 6],
          [W[1], 68_000, 6],
          [W[2], 68_000, 6],
          [W[3], 90_000, 6],
        ]),
      ],
      W[4],
    );
    expect(firing).toEqual([]);
  });

  test("two currencies of the same bucket are judged independently", () => {
    const eur = series([
      [W[1], 68_000, 5],
      [W[2], 68_000, 5],
      [W[3], 68_000, 5],
      [W[4], 68_500, 5],
    ]);
    const usd: SalaryBandSeries = {
      bucket: "engineering",
      currency: "USD",
      points: [
        { weekStart: W[1], p50: 150_000, n: 5 },
        { weekStart: W[2], p50: 150_000, n: 5 },
        { weekStart: W[3], p50: 150_000, n: 5 },
        { weekStart: W[4], p50: 180_000, n: 5 },
      ],
    };
    const firing = detectSalaryBandShift([eur, usd], W[4]);
    expect(firing).toHaveLength(1);
    expect(firing[0]?.currency).toBe("USD");
  });

  test("the trailing window never reaches past windowWeeks points", () => {
    const firing = detectSalaryBandShift(
      [
        series([
          ["2026-06-01", 10_000, 5],
          ["2026-06-08", 10_000, 5],
          [W[1], 68_000, 5],
          [W[2], 68_000, 5],
          [W[3], 68_000, 5],
          [W[4], 68_000, 5],
        ]),
      ],
      W[4],
    );
    // The two 10k weeks are outside the 4-week window; the baseline is 68k, so flat.
    expect(firing).toEqual([]);
  });
});

describe("disclosureVerdict", () => {
  test("yes needs both the share and the floor", () => {
    expect(disclosureVerdict(8, 21)).toBe("yes");
    expect(disclosureVerdict(2, 3)).toBe("partial"); // 67% but only 2 roles
    expect(disclosureVerdict(3, 30)).toBe("partial"); // 3 roles but only 10%
  });

  test("no means zero, not 'a bit'", () => {
    expect(disclosureVerdict(0, 21)).toBe("no");
    expect(disclosureVerdict(1, 21)).toBe("partial");
  });

  test("an empty board is 'no', never a divide by zero", () => {
    expect(disclosureVerdict(0, 0)).toBe("no");
  });
});

describe("weekly reconstruction", () => {
  const w = "2026-07-06"; // Monday

  test("a role opened mid-week counts for that week", () => {
    expect(wasActiveInWeek({ detectedAt: "2026-07-10T09:00:00Z", closedAt: null }, w)).toBe(true);
  });

  test("a role closed mid-week still counts for that week", () => {
    expect(
      wasActiveInWeek({ detectedAt: "2026-05-01T09:00:00Z", closedAt: "2026-07-08T09:00:00Z" }, w),
    ).toBe(true);
  });

  test("a role opened after the week does not", () => {
    expect(wasActiveInWeek({ detectedAt: "2026-07-14T09:00:00Z", closedAt: null }, w)).toBe(false);
  });

  test("a role closed before the week does not", () => {
    expect(
      wasActiveInWeek({ detectedAt: "2026-01-01T09:00:00Z", closedAt: "2026-07-05T09:00:00Z" }, w),
    ).toBe(false);
  });

  test("weeksBack walks Mondays backwards, oldest first", () => {
    expect(weeksBack("2026-07-27", 4)).toEqual([
      "2026-07-06",
      "2026-07-13",
      "2026-07-20",
      "2026-07-27",
    ]);
  });
});
