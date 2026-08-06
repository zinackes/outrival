import { test, expect } from "bun:test";
import {
  shortDate,
  mergeTrendsByDate,
  buildPricingSeries,
  buildReviewScoreSeries,
  ARCHIVED_KEY,
  CAPTURE_DAY_KEY,
} from "../src/app/dashboard/competitors/[id]/competitor-detail/charts";

// The analytics tables store `recorded_at` as a naive `timestamp`, so the API
// wraps it in `AT TIME ZONE 'UTC'` and Postgres renders a one-digit offset:
// "2026-07-11 23:02:25+00". Assertions stay timezone-agnostic (CI runs UTC, the
// dev machine doesn't) — what matters is that the label IS a label.
const PG_TS = "2026-07-11 23:02:25+00";

test("shortDate formats a Postgres +00 timestamp instead of echoing it", () => {
  const label = shortDate(PG_TS);
  expect(label).not.toBe(PG_TS);
  expect(label).toMatch(/^[A-Z][a-z]{2} \d{2}$/);
});

test("shortDate still formats a plain ISO instant", () => {
  expect(shortDate("2026-07-11T23:02:25.000Z")).toMatch(/^[A-Z][a-z]{2} \d{2}$/);
});

test("shortDate returns the input when it is not a date at all", () => {
  expect(shortDate("not a date")).toBe("not a date");
});

test("mergeTrendsByDate orders points by instant, not by label", () => {
  // Midday so the day never flips with the runner's offset, and out of order on
  // purpose: sorting used to run on a NaN timestamp and left the input untouched.
  const merged = mergeTrendsByDate([
    { department: "Engineering", count: 7, recorded_at: "2026-07-01 12:00:00+00" },
    { department: "Engineering", count: 4, recorded_at: "2026-06-01 12:00:00+00" },
    { department: "Sales", count: 2, recorded_at: "2026-06-01 12:00:00+00" },
  ]);

  expect(merged).toHaveLength(2);
  expect(merged[0]).toEqual({ date: shortDate("2026-06-01 12:00:00+00"), Engineering: 4, Sales: 2 });
  // Sales carries an explicit 0 on the day it wrote no row: the areas are stacked,
  // so a hole makes the top edge under-read the board total, and recharts paints
  // the missing point's end dot at the top of the plot area.
  expect(merged[1]).toEqual({
    date: shortDate("2026-07-01 12:00:00+00"),
    Engineering: 7,
    Sales: 0,
  });
});

test("mergeTrendsByDate stacks to the board total on every day", () => {
  const merged = mergeTrendsByDate([
    { department: "Engineering", count: 20, recorded_at: "2026-07-01 12:00:00+00" },
    { department: "Sales", count: 5, recorded_at: "2026-07-01 12:00:00+00" },
    { department: "Engineering", count: 25, recorded_at: "2026-07-02 12:00:00+00" },
    { department: "Sales", count: 7, recorded_at: "2026-07-02 12:00:00+00" },
    { department: "Support", count: 5, recorded_at: "2026-07-02 12:00:00+00" },
  ]);

  const departments = ["Engineering", "Sales", "Support"];
  const totals = merged.map((point) =>
    departments.reduce((sum, d) => sum + (point[d] as number), 0),
  );
  expect(totals).toEqual([25, 37]);
});

const tier = (plan: string, price: number | null, recorded_at: string) => ({
  plan_name: plan,
  price,
  currency: "USD",
  billing_period: "monthly",
  recorded_at,
});

test("buildPricingSeries orders captures by instant, not by the month label", () => {
  // The archive backfill seeds pricing months apart, so the labels sort lexically
  // into "Apr, Jan, Jul, May" — the exact scramble seen on a first scrape.
  const { points } = buildPricingSeries([
    tier("Agency", 79, "2026-04-14 12:00:00+00"),
    tier("Agency", 75, "2026-01-14 12:00:00+00"),
    tier("Agency", 89, "2026-07-28 12:00:00+00"),
    tier("Agency", 79, "2026-05-25 12:00:00+00"),
  ]);

  expect(points.map((p) => p.Agency)).toEqual([75, 79, 79, 89]);
});

test("buildPricingSeries keeps the same day of two years as two captures", () => {
  const { points } = buildPricingSeries([
    tier("Agency", 59, "2025-04-14 12:00:00+00"),
    tier("Agency", 79, "2026-04-14 12:00:00+00"),
  ]);

  expect(points.map((p) => p.Agency)).toEqual([59, 79]);
});

test("buildPricingSeries drops quote-based tiers from the points but keeps them in byPlan", () => {
  const { points, byPlan } = buildPricingSeries([
    tier("Agency", 79, "2026-07-28 12:00:00+00"),
    tier("Enterprise", null, "2026-07-28 12:00:00+00"),
  ]);

  expect(points).toHaveLength(1);
  expect(points[0]!.date).toBe(shortDate("2026-07-28 12:00:00+00"));
  expect(points[0]!.Agency).toBe(79);
  // The quote-based tier contributes no series key. Meta keys (P5: archive
  // provenance, capture day) are underscore-prefixed and deliberately excluded —
  // the caller derives its series from byPlan, never from a point's keys.
  expect(Object.keys(points[0]!).filter((k) => !k.startsWith("__") && k !== "date")).toEqual([
    "Agency",
  ]);
  expect(Object.keys(byPlan).sort()).toEqual(["Agency", "Enterprise"]);
});

test("buildPricingSeries marks a point rebuilt from the archive, and only that one", () => {
  const { points } = buildPricingSeries([
    { ...tier("Agency", 59, "2025-04-14 12:00:00+00"), origin: "archive" },
    { ...tier("Agency", 79, "2026-04-14 12:00:00+00"), origin: "live" },
  ]);

  expect(points[0]![ARCHIVED_KEY]).toBe(1);
  expect(points[1]![ARCHIVED_KEY]).toBeUndefined();
  expect(points[0]![CAPTURE_DAY_KEY]).toContain("2025");
});

test("buildReviewScoreSeries orders captures by instant, not by the month label", () => {
  const { points, sources } = buildReviewScoreSeries([
    { source: "g2", score: 4.4, recorded_at: "2026-04-14 12:00:00+00" },
    { source: "g2", score: 4.1, recorded_at: "2026-01-14 12:00:00+00" },
    { source: "g2", score: 4.6, recorded_at: "2026-07-28 12:00:00+00" },
  ]);

  expect(sources).toEqual(["g2"]);
  expect(points.map((p) => p.g2)).toEqual([4.1, 4.4, 4.6]);
});
