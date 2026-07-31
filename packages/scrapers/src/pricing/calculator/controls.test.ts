import { describe, expect, it } from "bun:test";
import { pickControl, reachableQuantities, type ControlCandidate } from "./controls";

const candidate = (over: Partial<ControlCandidate> = {}): ControlCandidate => ({
  selector: "#slider",
  kind: "range",
  label: "API requests per month",
  min: 1_000,
  max: 10_000_000,
  step: null,
  options: [],
  priceDistance: 2,
  ...over,
});

describe("pickControl", () => {
  it("picks the control whose label resolves to a canonical meter", () => {
    const out = pickControl([
      candidate({ selector: "#zip", label: "ZIP code", priceDistance: 1 }),
      candidate({ selector: "#reqs", label: "Monthly API calls" }),
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.control.selector).toBe("#reqs");
    expect(out.control.unit).toBe("request");
  });

  it("refuses when no label names a meter we know — unknown is not a unit", () => {
    const out = pickControl([candidate({ label: "How many widgets of doom" })]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("unit_unresolved");
  });

  it("ignores controls that sit nowhere near a price", () => {
    const out = pickControl([candidate({ priceDistance: 40 })]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("no_controls");
  });

  it("prefers the control nearest the price, then the one with the widest reach", () => {
    const out = pickControl([
      candidate({ selector: "#far", label: "seats", priceDistance: 6, max: 1_000 }),
      candidate({ selector: "#near", label: "seats", priceDistance: 1, max: 50 }),
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.control.selector).toBe("#near");

    const tie = pickControl([
      candidate({ selector: "#small", label: "seats", priceDistance: 1, max: 50 }),
      candidate({ selector: "#big", label: "seats", priceDistance: 1, max: 5_000 }),
    ]);
    expect(tie.ok).toBe(true);
    if (!tie.ok) return;
    expect(tie.control.selector).toBe("#big");
  });

  it("skips a single-option select — it can't be moved", () => {
    const out = pickControl([
      candidate({ kind: "select", options: [1_000], label: "requests", max: 1_000 }),
    ]);
    expect(out.ok).toBe(false);
  });
});

describe("reachableQuantities", () => {
  const base = { selector: "#s", kind: "range" as const, unit: "request", options: [] };

  it("drops volumes the control cannot express rather than approximating them", () => {
    const control = { ...base, min: 1_000, max: 100_000, step: null };
    expect(reachableQuantities(control, [1_000, 10_000, 100_000, 1_000_000])).toEqual([
      1_000, 10_000, 100_000,
    ]);
  });

  it("drops a volume a stepped slider would snap away from", () => {
    const control = { ...base, min: 0, max: 1_000_000, step: 250_000 };
    expect(reachableQuantities(control, [250_000, 300_000])).toEqual([250_000]);
  });

  it("keeps only the exact option values of a select", () => {
    const control = { ...base, kind: "select" as const, min: 10, max: 1_000, step: null, options: [10, 100, 1_000] };
    expect(reachableQuantities(control, [100, 500, 1_000])).toEqual([100, 1_000]);
  });
});
