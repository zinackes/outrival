import { describe, expect, test } from "bun:test";
import { noSummaryReason, reviewCaptureLine } from "@/lib/change-fallback";

// A change with no summary used to offer to run the classifier on it. Half of
// those rows were suppressed on purpose (below the significance threshold, or a
// review capture whose diff is meaningless), so the fallback has to say WHICH,
// and a review row has to print its numbers rather than nothing at all.

describe("noSummaryReason", () => {
  test("names each suppression the pipeline records", () => {
    expect(noSummaryReason("trivial_diff")).toMatch(/too small/i);
    expect(noSummaryReason("rotating_list")).toMatch(/rewrites its whole list/i);
    expect(noSummaryReason("cosmetic")).toMatch(/wording/i);
  });

  test("an unsuppressed change with no summary was simply never classified", () => {
    expect(noSummaryReason(null)).toBe("Not classified.");
    expect(noSummaryReason(undefined)).toBe("Not classified.");
  });

  test("an unknown reason degrades instead of rendering undefined", () => {
    expect(noSummaryReason("something_new")).toBe("Not classified.");
  });
});

describe("reviewCaptureLine", () => {
  const capture = {
    score: 4.6,
    reviewCount: 1203,
    prevScore: null,
    prevReviewCount: null,
  };

  test("prints rating and volume when there is no prior capture", () => {
    expect(reviewCaptureLine(capture)).toBe("4.6★ · 1,203 reviews");
  });

  test("shows the rating move and the new reviews since the last capture", () => {
    expect(
      reviewCaptureLine({ ...capture, prevScore: 4.7, prevReviewCount: 1191 }),
    ).toBe("4.7★ → 4.6★ · 1,203 reviews (+12)");
  });

  test("a shrinking review count keeps its sign", () => {
    expect(reviewCaptureLine({ ...capture, prevReviewCount: 1210 })).toBe(
      "4.6★ · 1,203 reviews (-7)",
    );
  });

  test("a rating that only moved below the printed precision reads as steady", () => {
    // 4.64 and 4.61 both print "4.6"; "4.6★ → 4.6★" would read as a bug.
    expect(reviewCaptureLine({ ...capture, score: 4.64, prevScore: 4.61 })).toBe(
      "4.6★ · 1,203 reviews",
    );
  });

  test("a source with a rating but no review count prints the rating alone", () => {
    expect(reviewCaptureLine({ ...capture, reviewCount: 0 })).toBe("4.6★");
  });
});
