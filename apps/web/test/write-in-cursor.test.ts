import { test, expect } from "bun:test";
import { planWriteIn, visibleAt, writeInRate } from "../src/lib/write-in-cursor";

const LINES = ["abcd", "ef", "ghijk"];
const PLAN = planWriteIn(LINES);

test("planWriteIn lays the lines end to end on one cursor", () => {
  expect(PLAN.starts).toEqual([0, 4, 6]);
  expect(PLAN.total).toBe(11);
});

test("a line that has not started reads as absent, not as an empty string", () => {
  // The distinction is what lets the card grow as it writes: null renders no row,
  // "" would render a bullet with nothing next to it.
  expect(visibleAt(LINES, PLAN, 0, 0)).toBeNull();
  expect(visibleAt(LINES, PLAN, 3, 1)).toBeNull();
  expect(visibleAt(LINES, PLAN, 6, 2)).toBeNull();
});

test("a line in flight reads as its written prefix", () => {
  expect(visibleAt(LINES, PLAN, 2, 0)).toBe("ab");
  expect(visibleAt(LINES, PLAN, 5, 1)).toBe("e");
  expect(visibleAt(LINES, PLAN, 9, 2)).toBe("ghi");
});

test("a finished line reads in full, so the caller drops its caret", () => {
  // The caret is rendered on `visible !== text`; a prefix that stays one short of
  // the full string would leave a caret blinking on a finished line forever.
  expect(visibleAt(LINES, PLAN, 4, 0)).toBe("abcd");
  expect(visibleAt(LINES, PLAN, 11, 2)).toBe("ghijk");
  // Past the end of the card, every line is complete.
  expect(visibleAt(LINES, PLAN, 999, 1)).toBe("ef");
});

test("no cursor means no animation: everything reads in full at once", () => {
  // The state a stored card opens in, and the one the animation lands in.
  expect(visibleAt(LINES, PLAN, null, 0)).toBe("abcd");
  expect(visibleAt(LINES, PLAN, null, 2)).toBe("ghijk");
});

test("an index past the end is absent rather than a crash", () => {
  expect(visibleAt(LINES, PLAN, 999, 3)).toBeNull();
});

test("empty lines never swallow the cursor", () => {
  // An empty section entry contributes no characters, so the lines after it must
  // still start where their own prefix sum says.
  const lines = ["ab", "", "cd"];
  const plan = planWriteIn(lines);
  expect(plan.starts).toEqual([0, 2, 2]);
  expect(visibleAt(lines, plan, 3, 2)).toBe("c");
});

test("a long card writes faster rather than for longer", () => {
  // Below the ceiling the base rate applies; above it, the rate stretches so the
  // whole card still lands inside the cap.
  expect(writeInRate(1000, 1100, 4500)).toBe(1100);
  expect(writeInRate(9000, 1100, 4500)).toBe(2000);
});
