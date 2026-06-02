import { test, expect, describe } from "bun:test";
import {
  normalizeLine,
  computeVolatileUpdates,
  filterVolatileLines,
  type VolatileState,
} from "../volatile-detector";

describe("normalizeLine", () => {
  test("strips numbers so a counter shares one signature", () => {
    expect(normalizeLine("Used by 10,234 teams")).toBe(normalizeLine("Used by 10,567 teams"));
  });
  test("strips dates, hashes, urls", () => {
    expect(normalizeLine("Build 2026-06-01 abcdef0123456789 https://x.com/y")).toBe("build");
  });
});

describe("computeVolatileUpdates", () => {
  test("a churning line increments change count and flips volatile at threshold", () => {
    // existing at 4 changes; one more change ⇒ volatile (threshold 5).
    const existing: VolatileState[] = [
      { pattern: normalizeLine("Used by teams"), changeCount: 4, stableCount: 0, isVolatile: false },
    ];
    const updates = computeVolatileUpdates(
      ["Used by 10,234 teams"],
      ["Used by 10,567 teams"],
      existing,
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]?.changeCount).toBe(5);
    expect(updates[0]?.isVolatile).toBe(true);
  });

  test("a stable volatile line counts down and becomes analysable again", () => {
    const pattern = normalizeLine("Used by teams");
    const existing: VolatileState[] = [
      { pattern, changeCount: 6, stableCount: 9, isVolatile: true },
    ];
    // identical text both sides ⇒ stable; stableCount 9→10 == resetThreshold ⇒ not volatile.
    const updates = computeVolatileUpdates(["Used by 10 teams"], ["Used by 10 teams"], existing);
    expect(updates[0]?.stableCount).toBe(10);
    expect(updates[0]?.isVolatile).toBe(false);
  });

  test("a brand-new monitor with no churn produces no updates", () => {
    expect(computeVolatileUpdates(["Hello world"], ["Hello world"], [])).toEqual([]);
  });
});

describe("filterVolatileLines", () => {
  test("drops lines whose signature is known volatile", () => {
    const volatile = new Set([normalizeLine("Used by teams")]);
    const kept = filterVolatileLines(
      ["Used by 99,999 teams", "We raised a Series B"],
      volatile,
    );
    expect(kept).toEqual(["We raised a Series B"]);
  });
});
