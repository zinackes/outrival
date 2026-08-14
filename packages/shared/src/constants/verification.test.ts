import { describe, expect, test } from "bun:test";
import {
  VERIFIED_OUTCOME,
  verificationGapLabel,
  verificationGapMinutes,
} from "./verification";

// The badge makes one claim with one number in it, on four surfaces. These tests
// pin the number's phrasing, and above all the cases where there ISN'T one — a
// badge that prints "0 min apart" or "-3 min apart" is worse than an unbadged
// signal, because it reads as a measurement.
describe("verificationGapLabel", () => {
  test("keeps the minutes while they are still a readable measurement", () => {
    expect(verificationGapLabel(47)).toBe("47 min");
    expect(verificationGapLabel(1)).toBe("1 min");
    expect(verificationGapLabel(89)).toBe("89 min");
  });

  test("switches to hours once minutes stop reading at a glance", () => {
    expect(verificationGapLabel(90)).toBe("2 h");
    expect(verificationGapLabel(180)).toBe("3 h");
  });

  test("states no number rather than a broken one", () => {
    // Null and undefined are "the two timestamps aren't both recorded"; zero and
    // negative are a clock that ran backwards. None of them is a measurement.
    expect(verificationGapLabel(null)).toBeNull();
    expect(verificationGapLabel(undefined)).toBeNull();
    expect(verificationGapLabel(0)).toBeNull();
    expect(verificationGapLabel(-12)).toBeNull();
    expect(verificationGapLabel(Number.NaN)).toBeNull();
    expect(verificationGapLabel(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("verificationGapMinutes", () => {
  test("measures the interval between the two captures", () => {
    expect(
      verificationGapMinutes("2026-08-14T09:00:00.000Z", "2026-08-14T09:47:00.000Z"),
    ).toBe(47);
    expect(
      verificationGapMinutes(new Date("2026-08-14T09:00:00Z"), new Date("2026-08-14T11:30:00Z")),
    ).toBe(150);
  });

  test("null unless both captures are stamped", () => {
    expect(verificationGapMinutes(null, "2026-08-14T09:47:00.000Z")).toBeNull();
    expect(verificationGapMinutes("2026-08-14T09:00:00.000Z", null)).toBeNull();
    expect(verificationGapMinutes(null, null)).toBeNull();
    expect(verificationGapMinutes("not a date", "2026-08-14T09:47:00.000Z")).toBeNull();
  });

  test("a pending row folds to no badge at all, end to end", () => {
    // The pair the callers actually use: an unfinished verification has a quick
    // check and no independent one, and must produce nothing to print.
    expect(verificationGapLabel(verificationGapMinutes("2026-08-14T09:00:00.000Z", null))).toBeNull();
  });
});

describe("VERIFIED_OUTCOME", () => {
  test("is the ledger's confirmed value, and only that one", () => {
    // Every surface gates on this constant, so it has to keep matching the DB.
    // `pending`, `not_reproduced` and `skipped` are all "no badge".
    expect(VERIFIED_OUTCOME).toBe("confirmed");
  });
});
