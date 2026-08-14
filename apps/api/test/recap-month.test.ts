import { describe, expect, test } from "bun:test";
import { resolveRecapMonth } from "../src/lib/monthly-recap";

// OUT-189 — `?month=` reaches this straight from the URL. A month outside 01-12 used
// to be accepted and rolled over by Date.UTC, so `2026-13` quietly returned January
// 2027 under a label that contradicted the link.
const NOW = new Date("2026-08-14T12:00:00.000Z");

describe("resolveRecapMonth", () => {
  test("a real month is pinned", () => {
    expect(resolveRecapMonth("2026-07", NOW).key).toBe("2026-07");
    expect(resolveRecapMonth("2025-01", NOW).key).toBe("2025-01");
    expect(resolveRecapMonth("2025-12", NOW).key).toBe("2025-12");
  });

  test("no month means the last complete one", () => {
    expect(resolveRecapMonth(undefined, NOW).key).toBe("2026-07");
  });

  test("a month that doesn't exist falls back instead of rolling over", () => {
    for (const bad of ["2026-13", "2026-00", "2026-99", "2026-7", "202607", "july", ""]) {
      expect(resolveRecapMonth(bad, NOW).key).toBe("2026-07");
    }
  });

  test("the window is a UTC half-open month", () => {
    const { start, end } = resolveRecapMonth("2026-02", NOW);
    expect(start.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
});
