import { describe, expect, test } from "bun:test";
import { computeJobsDelta, jobKey, type ExistingPosting } from "../src/lib/jobs-delta";

// Closure regression: a non-authoritative jobs extraction used to close every
// active posting it didn't see — mass-close on empty (phantom "hiring freeze"),
// or close-the-missing on a partial/truncated subset (phantom "role removed").
// Any closure must require the authoritative path (a real ATS board list); the
// fallback path (AI floor / SPA placeholder / careers HTML) may only ADD.

const posting = (id: string, title: string, department: string | null): ExistingPosting => ({
  id,
  title,
  department,
});
const extracted = (title: string, department: string) => ({ title, department });

describe("computeJobsDelta — closure guard (empty + partial)", () => {
  const existing = [posting("1", "Staff Engineer", "R&D"), posting("2", "AE", "Sales")];

  test("empty + NON-authoritative → skip, closes nothing", () => {
    const delta = computeJobsDelta(existing, [], false);
    expect(delta.skip).toBe(true);
    expect(delta.closedIds).toEqual([]);
    expect(delta.inserts).toEqual([]);
  });

  test("empty + authoritative (ATS returned []) → real closure of all postings", () => {
    const delta = computeJobsDelta(existing, [], true);
    expect(delta.skip).toBe(false);
    expect(delta.closedIds.sort()).toEqual(["1", "2"]);
  });

  test("partial NON-authoritative extraction never closes the unseen posting", () => {
    const delta = computeJobsDelta(existing, [extracted("Staff Engineer", "R&D")], false);
    expect(delta.skip).toBe(false);
    expect(delta.closedIds).toEqual([]);
    expect(delta.inserts).toEqual([]);
  });

  test("partial AUTHORITATIVE extraction closes the missing posting", () => {
    const delta = computeJobsDelta(existing, [extracted("Staff Engineer", "R&D")], true);
    expect(delta.skip).toBe(false);
    expect(delta.closedIds).toEqual(["2"]);
    expect(delta.inserts).toEqual([]);
  });

  test("a new posting is inserted, none closed", () => {
    const jobs = [extracted("Staff Engineer", "R&D"), extracted("AE", "Sales"), extracted("PM", "Product")];
    const delta = computeJobsDelta(existing, jobs, false);
    expect(delta.skip).toBe(false);
    expect(delta.inserts).toEqual([extracted("PM", "Product")]);
    expect(delta.closedIds).toEqual([]);
  });

  test("duplicate extracted keys dedupe for insert but never trigger a false close", () => {
    const delta = computeJobsDelta([], [extracted("PM", "Product"), extracted("pm", " product ")], false);
    expect(delta.skip).toBe(false);
    expect(delta.inserts).toEqual([extracted("PM", "Product")]);
    expect(delta.closedIds).toEqual([]);
  });

  test("jobKey is case/space-insensitive", () => {
    expect(jobKey("  Staff Engineer ", "R&D")).toBe(jobKey("staff engineer", " r&d "));
  });
});
