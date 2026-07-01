import { test, expect } from "bun:test";
import { collapseAnimatedCounters } from "./normalize-text";

test("strips the reported odometer garbage, keeps the surrounding copy", () => {
  const raw =
    "From cracking DSA to a job-ready LinkedIn profile — 0012345678900123456789.00123456789K+ students transformed, your campus is next.";
  const out = collapseAnimatedCounters(raw);
  expect(out).not.toMatch(/0123456789/);
  expect(out).toContain("job-ready LinkedIn profile");
  expect(out).toContain("K+ students transformed, your campus is next.");
});

test("collapses a single glued ribbon touching static text", () => {
  expect(collapseAnimatedCounters("0123456789K")).toBe("K");
});

test("collapses a double-cycle ribbon (two-digit counter)", () => {
  expect(collapseAnimatedCounters("01234567890123456789 raised")).toBe(" raised");
});

test("collapses a block-level ribbon (newline-separated digits from innerText)", () => {
  const raw = "Countries\n0\n1\n2\n3\n4\n5\n6\n7\n8\n9\nserved";
  const out = collapseAnimatedCounters(raw);
  expect(out).not.toMatch(/\d/);
  expect(out).toContain("Countries");
  expect(out).toContain("served");
});

test("collapses a descending ramp", () => {
  expect(collapseAnimatedCounters("x9876543210987654321y")).toBe("xy");
});

test("collapses a comma-separated (thousands-mark) ribbon", () => {
  expect(collapseAnimatedCounters("0123456,7890123456,789 users")).toBe(" users");
});

// --- must NOT touch real formatted numbers ---

test("preserves real prices", () => {
  expect(collapseAnimatedCounters("Business plan $16 → $14/seat")).toBe(
    "Business plan $16 → $14/seat",
  );
  expect(collapseAnimatedCounters("raises Series E, $200M")).toBe("raises Series E, $200M");
  expect(collapseAnimatedCounters("Trusted by 12,847 customers")).toBe("Trusted by 12,847 customers");
});

test("preserves dates, ratings and mixed numerics", () => {
  expect(collapseAnimatedCounters("Updated 2026-06-30, G2 score 4.4 → 4.2")).toBe(
    "Updated 2026-06-30, G2 score 4.4 → 4.2",
  );
  expect(collapseAnimatedCounters("Support 24/7 · 99.99% uptime")).toBe("Support 24/7 · 99.99% uptime");
});

test("preserves a space-separated NPS / rating scale (space is not a ribbon separator)", () => {
  const scale = "Rate us: 0 1 2 3 4 5 6 7 8 9 10";
  expect(collapseAnimatedCounters(scale)).toBe(scale);
});

test("no-ops on text without digits or on short input", () => {
  expect(collapseAnimatedCounters("no numbers here at all")).toBe("no numbers here at all");
  expect(collapseAnimatedCounters("$5")).toBe("$5");
  expect(collapseAnimatedCounters("")).toBe("");
});
