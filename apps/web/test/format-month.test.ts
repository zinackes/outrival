import { test, expect } from "bun:test";
import { formatMonth } from "../src/lib/format-date";

// The shipping lens prints one row per month bucket, keyed "YYYY-MM". The key is
// the data; these assert that only the rendering changes.

test("writes the month name out", () => {
  expect(formatMonth("2026-02")).toBe("Feb 2026");
});

test("holds in a timezone west of Greenwich", () => {
  // A local-midnight Date would render January here.
  const tz = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    expect(formatMonth("2026-02")).toBe("Feb 2026");
  } finally {
    process.env.TZ = tz;
  }
});

test("takes a long month when the caller asks for one", () => {
  expect(formatMonth("2026-02", { month: "long", year: "numeric" })).toBe("February 2026");
});

test("echoes anything that is not a month key", () => {
  expect(formatMonth("2026-13")).toBe("2026-13");
  expect(formatMonth("2026-02-11")).toBe("2026-02-11");
  expect(formatMonth("")).toBe("");
});
