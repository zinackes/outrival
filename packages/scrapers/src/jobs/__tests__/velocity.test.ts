import { describe, expect, it } from "bun:test";
import {
  detectHiringInflection,
  hiringSeverity,
  type WeekPoint,
} from "../velocity";
import type { DepartmentBucket } from "../departments";

// Build a weekly series from raw counts (week keys are arbitrary but sorted).
function series(counts: number[]): WeekPoint[] {
  return counts.map((openCount, i) => ({
    weekStart: `2026-01-${String(i + 1).padStart(2, "0")}`,
    openCount,
  }));
}

function one(bucket: DepartmentBucket, counts: number[]) {
  return new Map<DepartmentBucket, WeekPoint[]>([[bucket, series(counts)]]);
}

const OPTS = { threshold: 0.5, windowWeeks: 4 };

describe("detectHiringInflection — one signal per episode", () => {
  it("fires on the crossing week (spiking now, not spiking last week)", () => {
    // baseline 2 for 5 weeks, then 5 → 5 > 1.5×2.
    const firing = detectHiringInflection(one("engineering", [2, 2, 2, 2, 2, 5]), OPTS);
    expect(firing).toHaveLength(1);
    expect(firing[0]!.bucket).toBe("engineering");
    expect(firing[0]!.openCount).toBe(5);
    expect(firing[0]!.baselineAvg).toBe(2);
    expect(firing[0]!.ratio).toBe(2.5);
  });

  it("does NOT re-fire while the bucket stays elevated", () => {
    // Same episode continues: last week also spiking → already signalled.
    const firing = detectHiringInflection(one("engineering", [2, 2, 2, 2, 2, 5, 6]), OPTS);
    expect(firing).toHaveLength(0);
  });

  it("re-arms and fires again after it dips below the band and re-crosses", () => {
    // spike (idx5) → dip back to 2 (idx6-8) → re-cross at idx9.
    const firing = detectHiringInflection(
      one("engineering", [2, 2, 2, 2, 2, 5, 2, 2, 2, 5]),
      OPTS,
    );
    expect(firing).toHaveLength(1);
    expect(firing[0]!.openCount).toBe(5);
  });

  it("does not fire with a zero baseline (0 → any hire is noise, not velocity)", () => {
    expect(detectHiringInflection(one("engineering", [0, 0, 0, 0, 3]), OPTS)).toHaveLength(0);
  });

  it("does not fire without at least 4 weeks of prior history", () => {
    expect(detectHiringInflection(one("engineering", [2, 5, 9]), OPTS)).toHaveLength(0);
  });

  it("does not fire when the latest week is within the band", () => {
    expect(detectHiringInflection(one("engineering", [2, 2, 2, 2, 2, 3]), OPTS)).toHaveLength(0);
  });
});

describe("hiringSeverity", () => {
  it("is high for engineering and sales, medium otherwise", () => {
    expect(hiringSeverity("engineering")).toBe("high");
    expect(hiringSeverity("sales")).toBe("high");
    expect(hiringSeverity("marketing")).toBe("medium");
    expect(hiringSeverity("data_ml")).toBe("medium");
  });

  it("stamps the firing bucket's severity", () => {
    const firing = detectHiringInflection(one("marketing", [2, 2, 2, 2, 2, 5]), OPTS);
    expect(firing[0]!.severity).toBe("medium");
  });
});
