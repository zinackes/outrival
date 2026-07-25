import { describe, expect, test } from "bun:test";
import {
  capturedSummary,
  dayBounds,
  dayKeyOf,
  duration,
  eventOutcome,
} from "@/components/dashboard/activity/format";
import type { ActivityEvent } from "@/lib/api";

// The activity log groups by the VIEWER's day and asks the API for that day's
// quiet runs by UTC instant. If those two disagree by an offset, a day header
// says "38 checks" over rows from a different day, so the conversion is worth
// locking. Everything here is pure — the rendering is covered by the build.

const run = (over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  competitorId: "c1",
  competitorName: "Acme",
  sourceType: "pricing",
  status: "success",
  durationMs: 1200,
  recordedAt: "2026-07-25T09:12:00.000Z",
  ...over,
});

describe("eventOutcome", () => {
  test("a success carrying a change is a change", () => {
    expect(eventOutcome(run({ changeId: "chg-1" }))).toBe("change");
  });

  test("a success with no change and no earlier snapshot is the baseline", () => {
    expect(eventOutcome(run({ isFirstCapture: true }))).toBe("first_capture");
  });

  test("a success that found nothing folds in with the dedup runs", () => {
    expect(eventOutcome(run())).toBe("no_change");
    expect(eventOutcome(run({ status: "no_change" }))).toBe("no_change");
  });

  test("a failure is never read as a change, even carrying one", () => {
    expect(eventOutcome(run({ status: "failed", changeId: "chg-1" }))).toBe("failed");
  });
});

describe("day boundaries", () => {
  test("the bounds of a day are that day's local midnights, as UTC instants", () => {
    const { from, to } = dayBounds("2026-07-25");
    expect(new Date(from).getHours()).toBe(0);
    expect(new Date(from).getMinutes()).toBe(0);
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(24 * 60 * 60 * 1000);
  });

  test("an instant falls inside the bounds of the key it maps to", () => {
    // Four instants spread across the clock, so at least one lands on the far
    // side of the runner's own UTC offset.
    for (const iso of [
      "2026-07-25T00:30:00.000Z",
      "2026-07-25T09:12:00.000Z",
      "2026-07-25T18:45:00.000Z",
      "2026-07-25T23:50:00.000Z",
    ]) {
      const key = dayKeyOf(iso);
      const { from, to } = dayBounds(key);
      const t = new Date(iso).getTime();
      expect(t).toBeGreaterThanOrEqual(new Date(from).getTime());
      expect(t).toBeLessThan(new Date(to).getTime());
    }
  });

  test("consecutive days do not overlap or leave a gap", () => {
    expect(dayBounds("2026-07-25").to).toBe(dayBounds("2026-07-26").from);
  });
});

describe("capturedSummary", () => {
  test("an empty extraction has no summary, so the row can say nothing was found", () => {
    expect(capturedSummary({ kind: "jobs", total: 0, teams: 0, byDept: [] })).toBeNull();
    expect(
      capturedSummary({
        kind: "pricing",
        planCount: 0,
        minPrice: null,
        maxPrice: null,
        currency: null,
        plans: [],
        removedPlans: [],
      }),
    ).toBeNull();
    expect(capturedSummary({ kind: "reviews", score: null, reviewCount: 0, subScores: null })).toBeNull();
  });

  test("a price range collapses when every tier costs the same", () => {
    const base = { kind: "pricing" as const, planCount: 2, currency: "USD", plans: [], removedPlans: [] };
    expect(capturedSummary({ ...base, minPrice: 10, maxPrice: 30 })).toBe("2 plans · $10 to $30");
    expect(capturedSummary({ ...base, minPrice: 10, maxPrice: 10 })).toBe("2 plans · $10");
  });

  test("quote-only pricing states the plan count and no price", () => {
    expect(
      capturedSummary({
        kind: "pricing",
        planCount: 3,
        minPrice: null,
        maxPrice: null,
        currency: null,
        plans: [],
        removedPlans: [],
      }),
    ).toBe("3 plans");
  });

  test("job and review lines pluralise on their own counts", () => {
    expect(capturedSummary({ kind: "jobs", total: 1, teams: 1, byDept: [] })).toBe("1 open role");
    expect(capturedSummary({ kind: "jobs", total: 23, teams: 5, byDept: [] })).toBe("23 open roles, 5 teams");
    expect(capturedSummary({ kind: "reviews", score: 4.25, reviewCount: 1200, subScores: null })).toBe(
      "4.3★ · 1,200 reviews",
    );
  });
});

describe("duration", () => {
  test("names the unknown rather than printing a dash", () => {
    expect(duration(0)).toBe("unknown");
    expect(duration(940)).toBe("940ms");
    expect(duration(2400)).toBe("2.4s");
  });
});
