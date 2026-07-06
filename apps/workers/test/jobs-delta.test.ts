import { describe, expect, test } from "bun:test";
import { computeJobsDelta, jobKey, type ExistingPosting } from "../src/lib/jobs-delta";

// C1 regression: an empty jobs extraction used to mass-close every active posting
// (closedIds = all existing when nothing was seen), firing a phantom "hiring
// freeze" signal. It must only do that when the emptiness is authoritative (a
// real ATS board list), never when jobs=[] came from an AI-floor / SPA placeholder.

const posting = (id: string, title: string, department: string | null): ExistingPosting => ({
  id,
  title,
  department,
});
const extracted = (title: string, department: string) => ({ title, department });

describe("computeJobsDelta — C1 mass-close guard", () => {
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

  test("partial closure on a positive extraction still closes the missing one", () => {
    const delta = computeJobsDelta(existing, [extracted("Staff Engineer", "R&D")], false);
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
