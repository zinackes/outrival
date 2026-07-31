import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tallySalaryBands, wasActiveInWeek, weeksBack } from "@outrival/scrapers/jobs-hiring";

const SCRIPT = resolve(import.meta.dir, "../src/scripts/backfill-salary-bands.ts");
const source = readFileSync(SCRIPT, "utf8");

// The one property of this script that matters more than its arithmetic: replaying
// six months of history through the signal path would announce every pay move a
// competitor ever made, all at once, as news. Asserted structurally because there is
// no way to observe "did not emit" from the outside — a run that writes nothing and
// a run that never had a signal path look identical.
describe("the backfill can never emit a signal", () => {
  test("it does not reach the queue", () => {
    expect(source).not.toContain("@outrival/queue");
    expect(source).not.toContain("generateSignal");
    expect(source).not.toContain(".enqueue(");
  });

  test("it does not write the anchor → snapshot → change chain a signal hangs off", () => {
    for (const table of ["snapshots", "changes", "monitors"]) {
      expect(source.includes(`insert(${table})`)).toBe(false);
    }
    expect(source).not.toContain("uploadToR2");
  });

  test("the only table it inserts into is hiring_salary_bands", () => {
    const inserts = [...source.matchAll(/\.insert\((\w+)\)/g)].map((m) => m[1]);
    expect(inserts).toEqual(["hiringSalaryBands"]);
  });
});

// The reconstruction itself: the past board is rebuilt from detected_at/closed_at
// and banded by the SAME pure function the live path calls, so a backfilled week and
// a live week are the same number computed the same way.
describe("historical reconstruction on a dated fixture", () => {
  const posting = (
    detectedAt: string,
    closedAt: string | null,
    salary: number,
  ) => ({
    department: "Engineering",
    title: "Backend Engineer",
    salaryMin: salary,
    salaryMax: salary,
    salaryCurrency: "EUR",
    salaryPeriod: "yearly",
    detectedAt: new Date(detectedAt),
    closedAt: closedAt ? new Date(closedAt) : null,
  });

  // Three roles with different pay, opening and closing at known dates.
  const board = [
    posting("2026-06-01T00:00:00Z", "2026-07-10T00:00:00Z", 60_000),
    posting("2026-06-01T00:00:00Z", null, 70_000),
    posting("2026-07-15T00:00:00Z", null, 100_000),
  ];

  const bandFor = (week: string) => {
    const active = board.filter((p) => wasActiveInWeek(p, week));
    return tallySalaryBands(active)[0] ?? null;
  };

  test("the week of 6 July holds the two roles that were open then", () => {
    // The third role only opens on the 15th; the first has not closed yet.
    expect(bandFor("2026-07-06")).toMatchObject({
      currency: "EUR",
      n: 2,
      p25: 62_500,
      p50: 65_000,
      p75: 67_500,
    });
  });

  test("the week of 20 July holds a different board, and a different median", () => {
    // The 60k role closed on the 10th, the 100k one opened on the 15th — so the
    // median moves because the BOARD moved, which is the whole point of keeping
    // history rather than back-dating today's number.
    expect(bandFor("2026-07-20")).toMatchObject({ n: 2, p50: 85_000 });
  });

  test("a week before any role existed produces no band at all", () => {
    expect(bandFor("2026-05-04")).toBeNull();
  });
});

describe("week membership drives the reconstruction", () => {
  const p = (detectedAt: string, closedAt: string | null) => ({
    detectedAt: new Date(detectedAt),
    closedAt: closedAt ? new Date(closedAt) : null,
  });

  test("a role that opened after the week is not in it", () => {
    expect(wasActiveInWeek(p("2026-07-15T00:00:00Z", null), "2026-07-06")).toBe(false);
  });

  test("a role that closed inside the week is still in it", () => {
    expect(wasActiveInWeek(p("2026-06-01T00:00:00Z", "2026-07-10T00:00:00Z"), "2026-07-06")).toBe(
      true,
    );
  });

  test("the window walks whole ISO weeks backwards", () => {
    const weeks = weeksBack("2026-07-27", 26);
    expect(weeks).toHaveLength(26);
    expect(weeks[weeks.length - 1]).toBe("2026-07-27");
    expect(new Set(weeks).size).toBe(26);
  });
});
