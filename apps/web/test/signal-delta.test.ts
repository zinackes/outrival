import { test, expect } from "bun:test";
import { parseDelta, formatDeltaPct } from "../src/lib/signal-delta";

test("parseDelta pairs a currency figure across the same wording", () => {
  const d = parseDelta(
    "Pro plan — $16.00 per seat, billed monthly",
    "Pro plan — $14.00 per seat, billed monthly",
  );
  expect(d).not.toBeNull();
  expect(d!.before.raw).toBe("$16.00");
  expect(d!.after.raw).toBe("$14.00");
  expect(d!.direction).toBe("down");
  expect(d!.deltaPct).toBeCloseTo(-12.5);
});

test("parseDelta handles percentages and bare scores", () => {
  const pct = parseDelta("Free tier at 12% of seats", "Free tier at 18% of seats");
  expect(pct!.after.isPercent).toBe(true);
  expect(pct!.direction).toBe("up");

  const score = parseDelta("G2 rating 4.6 out of 5", "G2 rating 4.4 out of 5");
  expect(score!.before.value).toBe(4.6);
  expect(score!.after.value).toBe(4.4);
  expect(score!.after.currency).toBeNull();
});

test("parseDelta reads thousands separators", () => {
  const d = parseDelta("Starts at €1,299 a year", "Starts at €1,499 a year");
  expect(d!.before.value).toBe(1299);
  expect(d!.after.value).toBe(1499);
});

test("parseDelta refuses figures that measure different things", () => {
  // Different units.
  expect(parseDelta("Plan at $16", "Plan at 16%")).toBeNull();
  expect(parseDelta("Plan at $16", "Plan at €16")).toBeNull();
  // Unrelated sentences that merely both start with a number.
  expect(parseDelta("4 new sales roles opened", "2 Enterprise AEs hired")).toBeNull();
});

test("parseDelta returns null when there is nothing to compare", () => {
  expect(parseDelta(null, "Pro plan — $14.00")).toBeNull();
  expect(parseDelta("Pro plan — $16.00", null)).toBeNull();
  expect(parseDelta("Hero copy rewritten", "Hero copy rewritten again")).toBeNull();
  // Same value on both sides is not a change.
  expect(parseDelta("Pro plan — $16.00", "Pro plan — $16.00 per seat")).toBeNull();
});

test("parseDelta leaves the ratio undefined when the baseline is zero", () => {
  const d = parseDelta("Trial length 0 days", "Trial length 14 days");
  expect(d!.deltaPct).toBeNull();
});

test("formatDeltaPct signs and rounds to one decimal", () => {
  expect(formatDeltaPct(-12.5)).toBe("−12.5%");
  expect(formatDeltaPct(50)).toBe("+50%");
  expect(formatDeltaPct(33.333)).toBe("+33.3%");
});
