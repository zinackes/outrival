import { test, expect } from "bun:test";
import {
  shortDate,
  mergeTrendsByDate,
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
  expect(merged[1]).toEqual({ date: shortDate("2026-07-01 12:00:00+00"), Engineering: 7 });
});
