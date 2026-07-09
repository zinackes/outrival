import { describe, expect, test } from "bun:test";
import { unsupportedNumbers, significantNumbers } from "./numeric-grounding";

describe("unsupportedNumbers — R3 numeric-hallucination guard", () => {
  test("a supported price is grounded", () => {
    expect(unsupportedNumbers("They now charge $99/mo.", "Pro plan — $99 per month")).toEqual([]);
  });

  test("an invented percentage is flagged (derived from source prices)", () => {
    // 99 is in the source; the 41% is derived and not literally present.
    expect(unsupportedNumbers("Raised the Pro tier to $99, a 41% jump.", "Pro was $70, now $99")).toEqual([
      "41",
    ]);
  });

  test("an invented absolute stat is flagged", () => {
    expect(unsupportedNumbers("Now serving over 10,000 customers.", "Trusted by teams worldwide")).toEqual([
      "10000",
    ]);
  });

  test("comma / currency formatting differences still match", () => {
    expect(unsupportedNumbers("over 10,000 users", "10000 teams and counting")).toEqual([]);
    expect(unsupportedNumbers("costs $1,299", "1299 EUR one-time")).toEqual([]);
  });

  test("trivial small integers are ignored", () => {
    expect(unsupportedNumbers("Added 3 plans and 2 add-ons.", "")).toEqual([]);
  });

  test("bare years are ignored", () => {
    expect(unsupportedNumbers("Founded in 2019, they pivoted in 2021.", "")).toEqual([]);
  });

  test("decimals are grounded strictly", () => {
    expect(unsupportedNumbers("rated 4.8 stars", "score: 4.8/5")).toEqual([]);
    expect(unsupportedNumbers("rated 4.8 stars", "score: 4.5/5")).toEqual(["4.8"]);
  });

  test("significantNumbers skips single digits but keeps units and multi-digit", () => {
    expect(significantNumbers("3 plans, $99, 40%, 10x, 1,000")).toEqual(["99", "40", "10", "1000"]);
  });
});
