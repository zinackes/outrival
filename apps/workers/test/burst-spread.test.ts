import { describe, expect, it } from "bun:test";
import { spreadOverWindow } from "../src/lib/burst-spread";

const SPREAD = 3000;
const items = (n: number): string[] => Array.from({ length: n }, (_, i) => `m${i}`);

// Deterministic "shuffle": always picks the last candidate, so the order is preserved.
const identityRand = () => 0.999999;

describe("spreadOverWindow", () => {
  it("keeps every item exactly once", () => {
    const out = spreadOverWindow(items(50), SPREAD);
    expect(out.length).toBe(50);
    expect(new Set(out.map((o) => o.item)).size).toBe(50);
  });

  it("puts every offset inside the window", () => {
    for (const { startAfterSec } of spreadOverWindow(items(2051), SPREAD)) {
      expect(startAfterSec).toBeGreaterThanOrEqual(0);
      expect(startAfterSec).toBeLessThan(SPREAD);
    }
  });

  it("starts the batch immediately and never touches the next cron's minute", () => {
    const out = spreadOverWindow(items(100), SPREAD, identityRand);
    expect(out[0]!.startAfterSec).toBe(0);
    expect(out.at(-1)!.startAfterSec).toBe(2970); // 99/100 * 3000
  });

  it("walks evenly, so no minute of the window carries a wall", () => {
    const out = spreadOverWindow(items(2051), SPREAD, identityRand);
    const perMinute = new Map<number, number>();
    for (const { startAfterSec } of out) {
      const m = Math.floor(startAfterSec / 60);
      perMinute.set(m, (perMinute.get(m) ?? 0) + 1);
    }
    // 2051 monitors over 50 minutes is ~41/minute; the walk must not exceed that by
    // more than one item of rounding.
    expect(Math.max(...perMinute.values())).toBeLessThanOrEqual(42);
  });

  it("does not mutate the caller's array", () => {
    const original = items(10);
    const copy = [...original];
    spreadOverWindow(original, SPREAD);
    expect(original).toEqual(copy);
  });

  it("shuffles, so the same org is not last every hour", () => {
    const input = items(200);
    const a = spreadOverWindow(input, SPREAD).map((o) => o.item);
    const b = spreadOverWindow(input, SPREAD).map((o) => o.item);
    expect(a).not.toEqual(b);
    expect([...a].sort()).toEqual([...b].sort());
  });

  it("collapses to the old single-batch behaviour when the spread is disabled", () => {
    const out = spreadOverWindow(items(20), 0);
    expect(out.every((o) => o.startAfterSec === 0)).toBe(true);
  });

  it("handles the degenerate sizes", () => {
    expect(spreadOverWindow([], SPREAD)).toEqual([]);
    expect(spreadOverWindow(["only"], SPREAD)).toEqual([{ item: "only", startAfterSec: 0 }]);
  });
});
