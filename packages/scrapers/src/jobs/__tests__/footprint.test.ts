import { describe, expect, test } from "bun:test";
import {
  detectFirstAppearances,
  detectHiringFreeze,
  tallyHiringGeo,
  namedBuckets,
  FREEZE_DEFAULTS,
  FIRST_COUNTRY_MIN_WEEKS,
  NEW_DEPARTMENT_MIN_WEEKS,
  type FreezeWindow,
  type WeeklyKeyRow,
} from "../footprint";
import type { DepartmentBucket } from "../departments";

function history(...pairs: Array<[string, string]>): WeeklyKeyRow[] {
  return pairs.map(([key, weekStart]) => ({ key, weekStart }));
}

describe("detectFirstAppearances", () => {
  const threeWeeks = history(
    ["FR", "2026-07-06"],
    ["GB", "2026-07-06"],
    ["FR", "2026-07-13"],
    ["FR", "2026-07-20"],
  );

  test("surfaces a key that appears in no prior week", () => {
    expect(detectFirstAppearances(["FR", "DE"], threeWeeks, FIRST_COUNTRY_MIN_WEEKS)).toEqual([
      "DE",
    ]);
  });

  test("a key seen in ANY prior week is not first", () => {
    // GB appeared once, three weeks ago, and then stopped. Coming back is not a
    // first role in the country.
    expect(detectFirstAppearances(["FR", "GB"], threeWeeks, FIRST_COUNTRY_MIN_WEEKS)).toEqual([]);
  });

  test("baseline: nothing fires until enough weeks are behind it", () => {
    const oneWeek = history(["FR", "2026-07-20"]);
    // Onboarding a competitor must not announce a first role in every country they
    // happen to be hiring in on day one.
    expect(detectFirstAppearances(["FR", "DE", "US"], oneWeek, FIRST_COUNTRY_MIN_WEEKS)).toEqual([]);
    expect(detectFirstAppearances(["FR", "DE"], [], FIRST_COUNTRY_MIN_WEEKS)).toEqual([]);
  });

  test("weeks are counted distinctly, not as rows", () => {
    // Two countries in ONE week is one week of history, not two.
    const oneWeekTwoRows = history(["FR", "2026-07-20"], ["GB", "2026-07-20"]);
    expect(detectFirstAppearances(["DE"], oneWeekTwoRows, 2)).toEqual([]);
  });

  test("departments use a longer baseline", () => {
    const twoWeeks = history(["engineering", "2026-07-13"], ["engineering", "2026-07-20"]);
    expect(detectFirstAppearances(["design"], twoWeeks, NEW_DEPARTMENT_MIN_WEEKS)).toEqual([]);
    const threeWeeksBuckets = history(
      ["engineering", "2026-07-06"],
      ["engineering", "2026-07-13"],
      ["engineering", "2026-07-20"],
    );
    expect(detectFirstAppearances(["design"], threeWeeksBuckets, NEW_DEPARTMENT_MIN_WEEKS)).toEqual([
      "design",
    ]);
  });

  test("output is deduplicated and sorted", () => {
    const base = history(["FR", "2026-07-06"], ["FR", "2026-07-13"]);
    expect(detectFirstAppearances(["US", "DE", "US"], base, 2)).toEqual(["DE", "US"]);
  });
});

describe("detectHiringFreeze", () => {
  const frozen: FreezeWindow = {
    openAtStart: 20,
    closedInWindow: 14,
    openedInWindow: 0,
    confirmedByLaterRun: true,
    boardStable: true,
  };

  test("fires on a board that emptied and did not refill", () => {
    const verdict = detectHiringFreeze(frozen);
    expect(verdict).not.toBeNull();
    expect(verdict!.closed).toBe(14);
    expect(verdict!.closedShare).toBeCloseTo(0.7, 5);
  });

  test("does not fire below the closure ratio", () => {
    expect(detectHiringFreeze({ ...frozen, closedInWindow: 11 })).toBeNull();
    // Exactly at the threshold is a freeze.
    expect(detectHiringFreeze({ ...frozen, closedInWindow: 12 })).not.toBeNull();
  });

  test("does not fire on a small board", () => {
    expect(
      detectHiringFreeze({ ...frozen, openAtStart: 4, closedInWindow: 4 }),
    ).toBeNull();
  });

  test("does not fire while they are still opening roles", () => {
    expect(detectHiringFreeze({ ...frozen, openedInWindow: 2 })).toBeNull();
    // One replacement req does not make a board unfrozen.
    expect(detectHiringFreeze({ ...frozen, openedInWindow: 1 })).not.toBeNull();
  });

  test("does not fire on the run that did the closing", () => {
    // The single most likely false positive: an ATS answers 200 with a short list.
    expect(detectHiringFreeze({ ...frozen, confirmedByLaterRun: false })).toBeNull();
  });

  test("does not fire when the board itself moved", () => {
    // Switching ATS closes every posting of the old board at once.
    expect(detectHiringFreeze({ ...frozen, boardStable: false })).toBeNull();
  });

  test("thresholds are configurable", () => {
    const strict = { ...FREEZE_DEFAULTS, closedRatio: 0.9 };
    expect(detectHiringFreeze(frozen, strict)).toBeNull();
  });
});

describe("tallyHiringGeo", () => {
  test("a posting naming two countries counts in both", () => {
    const counts = tallyHiringGeo([
      { countryCodes: ["FR", "GB"], geoResolution: "country" },
      { countryCodes: ["FR"], geoResolution: "country" },
    ]);
    expect(counts.get("FR")).toBe(2);
    expect(counts.get("GB")).toBe(1);
  });

  test("non-country outcomes are recorded, not dropped", () => {
    const counts = tallyHiringGeo([
      { countryCodes: [], geoResolution: "remote" },
      { countryCodes: [], geoResolution: "region" },
      { countryCodes: [], geoResolution: "unknown" },
      // Never resolved at all (pre-P2 row): counted as unresolved, never silently
      // dropped — a board missing from its own chart reads as a shrinking board.
      { countryCodes: null, geoResolution: null },
    ]);
    expect(counts.get("remote")).toBe(1);
    expect(counts.get("region")).toBe(1);
    expect(counts.get("unresolved")).toBe(2);
  });

  test("a country resolution with no codes is not a country", () => {
    const counts = tallyHiringGeo([{ countryCodes: [], geoResolution: "country" }]);
    expect(counts.get("unresolved")).toBe(1);
    expect([...counts.keys()]).toEqual(["unresolved"]);
  });
});

describe("namedBuckets", () => {
  test("drops the unknown bucket and empty buckets", () => {
    const counts = new Map<DepartmentBucket, number>([
      ["engineering", 3],
      ["unknown", 5],
      ["sales", 0],
      ["design", 1],
    ]);
    expect(namedBuckets(counts)).toEqual(["design", "engineering"]);
  });
});
