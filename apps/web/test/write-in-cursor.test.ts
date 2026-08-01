import { test, expect } from "bun:test";
import { drainRate, planWriteIn, visibleAt } from "../src/lib/write-in-cursor";

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

test("the rate follows the backlog, floored and capped", () => {
  // A short backlog writes at the floor rather than crawling out over `seconds`.
  expect(drainRate(100, { seconds: 5, min: 55, max: 240 })).toBe(55);
  // In the band, the backlog sets the pace.
  expect(drainRate(600, { seconds: 5, min: 55, max: 240 })).toBe(120);
  // A whole card landing at once is capped, so it still reads as writing.
  expect(drainRate(3000, { seconds: 5, min: 55, max: 240 })).toBe(240);
  // The run-out has no ceiling — it only has to finish quickly, not stay readable.
  expect(drainRate(3000, { seconds: 1.2, min: 320 })).toBe(2500);
});
