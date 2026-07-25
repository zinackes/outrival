import { describe, expect, test } from "bun:test";
import { dedupeVerbatims } from "../src/lib/review-verbatims";

describe("dedupeVerbatims", () => {
  test("drops phrases re-extracted by a later scrape", () => {
    // What the reviews tab was showing: three complaints, then two of them again
    // because the next run wrote the same page's verbatims a second time.
    expect(
      dedupeVerbatims(
        [
          "Missing critical features",
          "Removed ability to see users",
          "Cannot insert help center articles",
          "Removed ability to see users",
          "Cannot insert help center articles",
        ],
        5,
      ),
    ).toEqual([
      "Missing critical features",
      "Removed ability to see users",
      "Cannot insert help center articles",
    ]);
  });

  test("keeps the fuller phrasing when one restates the other", () => {
    expect(
      dedupeVerbatims(["Web-based access on the go", "Push notifications", "Web-based access"], 5),
    ).toEqual(["Web-based access on the go", "Push notifications"]);
  });

  test("ignores case, punctuation and spacing when comparing", () => {
    expect(dedupeVerbatims(["Support is slow.", "  support is SLOW  "], 5)).toEqual([
      "Support is slow.",
    ]);
  });

  test("a short phrase never swallows a longer one that contains it", () => {
    expect(dedupeVerbatims(["Support", "Support is slow"], 5)).toEqual([
      "Support",
      "Support is slow",
    ]);
  });

  test("caps the list and skips empty content", () => {
    expect(dedupeVerbatims(["a", "", "   ", "b", "c"], 2)).toEqual(["a", "b"]);
  });

  test("drops null content instead of passing a blank bullet through", () => {
    expect(dedupeVerbatims([null, "Slow onboarding", undefined], 5)).toEqual(["Slow onboarding"]);
  });
});
