import { test, expect, describe } from "bun:test";
import {
  normalizeAnnualSalary,
  percentile,
  hasDisclosedSalary,
  ANNUAL_INFERENCE_FLOOR,
  isSalaryPeriod,
} from "./salary-normalize";

const sal = (
  min: number | null,
  max: number | null,
  currency: string | null,
  period: string | null,
) => normalizeAnnualSalary({ min, max, currency, period });

describe("annualisation", () => {
  test("a yearly range is taken as-is, at its midpoint", () => {
    expect(sal(60_000, 80_000, "EUR", "yearly")).toEqual({
      annualMidpoint: 70_000,
      currency: "EUR",
      periodSource: "stated",
    });
  });

  test("a monthly figure is multiplied by 12 (3 500 EUR/month reads 42 000)", () => {
    expect(sal(3_500, 3_500, "EUR", "monthly")?.annualMidpoint).toBe(42_000);
    // A monthly RANGE annualises on its midpoint, not on either bound.
    expect(sal(3_000, 4_000, "EUR", "monthly")?.annualMidpoint).toBe(42_000);
  });

  test("hourly and daily rates are excluded, never annualised", () => {
    expect(sal(45, 60, "USD", "hourly")).toBeNull();
    expect(sal(500, 700, "EUR", "daily")).toBeNull();
    // Even when the amount would look like a plausible annual salary on its own.
    expect(sal(80_000, 90_000, "USD", "hourly")).toBeNull();
  });

  test("the period is read case- and whitespace-insensitively", () => {
    expect(sal(3_000, null, "EUR", " Monthly ")?.annualMidpoint).toBe(36_000);
  });
});

describe("midpoint convention", () => {
  test("a single disclosed bound contributes that bound", () => {
    expect(sal(90_000, null, "USD", "yearly")?.annualMidpoint).toBe(90_000);
    expect(sal(null, 120_000, "USD", "yearly")?.annualMidpoint).toBe(120_000);
  });

  test("an odd midpoint is rounded to the unit, not floored", () => {
    expect(sal(60_001, 80_000, "GBP", "yearly")?.annualMidpoint).toBe(70_001);
  });
});

describe("currency", () => {
  test("no currency means excluded — a band is per currency and FX is never applied", () => {
    expect(sal(60_000, 80_000, null, "yearly")).toBeNull();
    expect(sal(60_000, 80_000, "  ", "yearly")).toBeNull();
  });

  test("the currency is upper-cased so eur and EUR key the same band", () => {
    expect(sal(60_000, 80_000, "eur", "yearly")?.currency).toBe("EUR");
  });

  test("different currencies stay different keys — nothing merges them", () => {
    const eur = sal(70_000, 70_000, "EUR", "yearly");
    const usd = sal(70_000, 70_000, "USD", "yearly");
    expect(eur?.currency).not.toBe(usd?.currency);
    expect(eur?.annualMidpoint).toBe(usd?.annualMidpoint as number);
  });
});

describe("missing period", () => {
  test("an amount at or above the floor can only be annual", () => {
    expect(sal(ANNUAL_INFERENCE_FLOOR, 30_000, "EUR", null)).toEqual({
      annualMidpoint: 25_000,
      currency: "EUR",
      periodSource: "inferred",
    });
    expect(sal(120_000, 160_000, "USD", null)?.periodSource).toBe("inferred");
  });

  test("an ambiguous amount is excluded rather than guessed", () => {
    // 3 500 with no period could be a monthly salary or a very junior annual one.
    expect(sal(3_500, 4_200, "EUR", null)).toBeNull();
    expect(sal(null, 15_000, "EUR", null)).toBeNull();
  });

  test("the LOWEST bound settles it — a wide range with a low floor stays ambiguous", () => {
    // 4 000–90 000 is exactly the shape a page mixing a monthly and an annual
    // figure produces; reading it as annual would put 47 000 into the band.
    expect(sal(4_000, 90_000, "EUR", null)).toBeNull();
  });

  test("an unrecognised period string falls back to the amount rule, not to yearly", () => {
    expect(sal(3_500, 3_500, "EUR", "per fortnight")).toBeNull();
    expect(sal(90_000, 90_000, "EUR", "per fortnight")?.periodSource).toBe("inferred");
  });
});

describe("junk ranges", () => {
  test("a zero or negative bound drops the posting", () => {
    expect(sal(0, 1, "EUR", "yearly")).toBeNull();
    expect(sal(0, 90_000, "EUR", "yearly")).toBeNull();
    expect(sal(-5, 90_000, "EUR", "yearly")).toBeNull();
  });

  test("an inverted range drops the posting whole", () => {
    expect(sal(120_000, 80_000, "USD", "yearly")).toBeNull();
  });

  test("an annualised figure below any plausible salary is dropped", () => {
    expect(sal(50, 60, "EUR", "yearly")).toBeNull();
    // Same numbers stated monthly are still not a salary.
    expect(sal(50, 60, "EUR", "monthly")).toBeNull();
  });

  test("no amount at all is not a salary", () => {
    expect(sal(null, null, "EUR", "yearly")).toBeNull();
  });
});

describe("percentile", () => {
  test("matches percentile_cont on a known series", () => {
    const s = [10, 20, 30, 40];
    expect(percentile(s, 0.25)).toBe(17.5);
    expect(percentile(s, 0.5)).toBe(25);
    expect(percentile(s, 0.75)).toBe(32.5);
  });

  test("a single value is its own p25/p50/p75", () => {
    expect(percentile([42], 0.25)).toBe(42);
    expect(percentile([42], 0.75)).toBe(42);
  });

  test("an empty series has no percentile rather than zero", () => {
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe("disclosure", () => {
  test("either bound counts as disclosed", () => {
    expect(hasDisclosedSalary({ salaryMin: 1, salaryMax: null })).toBe(true);
    expect(hasDisclosedSalary({ salaryMin: null, salaryMax: 1 })).toBe(true);
    expect(hasDisclosedSalary({ salaryMin: null, salaryMax: null })).toBe(false);
  });

  test("isSalaryPeriod only accepts the four stored values", () => {
    expect(isSalaryPeriod("yearly")).toBe(true);
    expect(isSalaryPeriod("annual")).toBe(false);
    expect(isSalaryPeriod(null)).toBe(false);
  });
});
