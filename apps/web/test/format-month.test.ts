import { test, expect } from "bun:test";
import { formatMonth } from "../src/lib/format-date";

// The shipping lens prints one row per month bucket, keyed "YYYY-MM". The key is
// the data; these assert that only the rendering changes.

test("writes the month name out", () => {
  expect(formatMonth("2026-02")).toBe("Feb 2026");
});

test("holds in a timezone west of Greenwich", () => {
  // A local-midnight Date would render January here.
  //
  // The zone is asked of Intl directly rather than set through `process.env.TZ`:
  // once the runtime has resolved a zone there is no way back, so restoring the
  // variable does NOT restore the zone — and when TZ was unset to begin with,
  // `process.env.TZ = undefined` restores nothing at all. The old form leaked
  // America/Los_Angeles into every test file that ran after this one in the same
  // process, which is what made the suite's result depend on file order.
  expect(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      year: "numeric",
    }).format(new Date(Date.UTC(2026, 1, 1))),
  ).toBe("Jan 2026");
  expect(formatMonth("2026-02")).toBe("Feb 2026");
});

test("takes a long month when the caller asks for one", () => {
  expect(formatMonth("2026-02", { month: "long", year: "numeric" })).toBe("February 2026");
});

test("echoes anything that is not a month key", () => {
  expect(formatMonth("2026-13")).toBe("2026-13");
  expect(formatMonth("2026-02-11")).toBe("2026-02-11");
  expect(formatMonth("")).toBe("");
});
