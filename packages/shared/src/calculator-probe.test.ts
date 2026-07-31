import { describe, expect, it } from "bun:test";
import {
  validateProbeSeries,
  diffProbePoints,
  MAX_PROBE_MONTHLY_COST,
  type MeasuredPoint,
  type ProbeReading,
} from "./calculator-probe";

const r = (qty: number, cost: number, extra: Partial<ProbeReading> = {}): ProbeReading => ({
  qty,
  cost,
  currency: "USD",
  ...extra,
});

describe("validateProbeSeries", () => {
  it("accepts a rising series and sorts it by quantity", () => {
    const out = validateProbeSeries([r(100_000, 800), r(1_000, 25), r(10_000, 120)]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.readings.map((x) => x.qty)).toEqual([1_000, 10_000, 100_000]);
    expect(out.currency).toBe("USD");
  });

  it("accepts a flat band — a minimum can swallow the usage", () => {
    expect(validateProbeSeries([r(1_000, 50), r(10_000, 50)]).ok).toBe(true);
  });

  it("drops a series that gets cheaper as the volume grows", () => {
    const out = validateProbeSeries([r(1_000, 120), r(10_000, 80)]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("non_monotonic");
  });

  it("tolerates cent-level jitter rather than calling it a decrease", () => {
    expect(validateProbeSeries([r(1_000, 100), r(10_000, 99.8)]).ok).toBe(true);
  });

  it("drops the run when the same quantity read differently twice", () => {
    const out = validateProbeSeries([r(1_000, 100, { recheck: 140 }), r(10_000, 300)]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("reread_mismatch");
  });

  it("accepts a double reading that agrees", () => {
    expect(validateProbeSeries([r(1_000, 100, { recheck: 100.2 })]).ok).toBe(true);
  });

  it("refuses a mixed-currency series", () => {
    const out = validateProbeSeries([r(1_000, 10), r(10_000, 20, { currency: "EUR" })]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("currency_mismatch");
  });

  it("refuses zero, negative and absurd amounts", () => {
    expect(validateProbeSeries([r(1_000, 0)]).ok).toBe(false);
    expect(validateProbeSeries([r(1_000, -5)]).ok).toBe(false);
    const huge = validateProbeSeries([r(1_000, MAX_PROBE_MONTHLY_COST + 1)]);
    expect(huge.ok).toBe(false);
    if (huge.ok) return;
    expect(huge.reason).toBe("implausible_cost");
  });

  it("refuses an empty run and a duplicated quantity", () => {
    expect(validateProbeSeries([]).ok).toBe(false);
    const dup = validateProbeSeries([r(1_000, 10), r(1_000, 10)]);
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.reason).toBe("duplicate_qty");
  });
});

const point = (qty: number, cost: number): MeasuredPoint => ({
  planName: "Usage calculator",
  meterUnit: "request",
  referenceQty: qty,
  effectiveMonthlyCost: cost,
  currency: "USD",
});

describe("diffProbePoints", () => {
  it("says nothing about a move under 5%", () => {
    expect(diffProbePoints([point(100_000, 80)], [point(100_000, 83)])).toEqual([]);
  });

  it("reads a 5-15% move as medium", () => {
    const [change] = diffProbePoints([point(100_000, 80)], [point(100_000, 72)]);
    expect(change?.severity).toBe("medium");
    expect(change?.type).toBe("rate_changed");
    expect(change?.direction).toBe("down");
  });

  it("reads a move past 15% as high, and never critical", () => {
    const [change] = diffProbePoints([point(100_000, 80)], [point(100_000, 40)]);
    expect(change?.severity).toBe("high");
    // A measured reading is one observation of a UI — critical bypasses every
    // moderation layer, and a probe alone does not earn that.
    expect(change?.severity).not.toBe("critical");
  });

  it("carries the exact measured amounts and the volume into the human sides", () => {
    const [change] = diffProbePoints([point(100_000, 80)], [point(100_000, 64)]);
    expect(change?.humanBefore).toBe("$80 at 100,000 requests");
    expect(change?.humanAfter).toBe("$64 at 100,000 requests");
    expect(change?.summary).toContain("measured on their own calculator");
  });

  it("only compares equal quantities", () => {
    expect(diffProbePoints([point(10_000, 100)], [point(100_000, 800)])).toEqual([]);
  });

  it("says nothing on a first run (no baseline)", () => {
    expect(diffProbePoints([], [point(10_000, 100)])).toEqual([]);
  });
});
