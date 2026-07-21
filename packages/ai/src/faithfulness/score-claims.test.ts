import { describe, expect, test } from "bun:test";
import { isClaimSupported, scoreClaims, verbatimRatio } from "./score-claims";

// The per-claim layer is the EXISTING fuzzy citation validator called one claim at
// a time. These tests pin the granularity contract (one claim → one verdict) and
// the two answers the judge must never be asked for: an exact quote is supported,
// no quote at all is not.

const SOURCE = `<competitor_pricing>
Starter — $49/month
Growth — $199/month
</competitor_pricing>
<competitor_reviews>
Complaint: "The dashboard is slow with large datasets."
</competitor_reviews>`;

describe("isClaimSupported", () => {
  test("an exact quote from the source is supported", () => {
    expect(
      isClaimSupported({ text: "Starter costs $49/month.", citedQuote: "Starter — $49/month" }, SOURCE),
    ).toBe(true);
  });

  test("a lightly re-spaced quote still matches (fuzzy, unchanged threshold)", () => {
    expect(
      isClaimSupported(
        { text: "Growth costs $199/month.", citedQuote: "Growth  —  $199/month" },
        SOURCE,
      ),
    ).toBe(true);
  });

  test("a quote that is nowhere in the source is not supported", () => {
    expect(
      isClaimSupported(
        { text: "Acme is SOC 2 certified.", citedQuote: "Acme holds a SOC 2 Type II certification" },
        SOURCE,
      ),
    ).toBe(false);
  });

  test("no quote at all is not supported — the invented-sentence path", () => {
    expect(isClaimSupported({ text: "Acme has no SOC 2 certification.", citedQuote: "" }, SOURCE)).toBe(
      false,
    );
  });
});

describe("verbatimRatio", () => {
  test("counts supported claims over the total", () => {
    const scored = scoreClaims(
      [
        { text: "a", citedQuote: "Starter — $49/month" },
        { text: "b", citedQuote: "Growth — $199/month" },
        { text: "c", citedQuote: "" },
      ],
      SOURCE,
    );
    expect(scored.map((s) => s.supported)).toEqual([true, true, false]);
    expect(verbatimRatio(scored)).toBeCloseTo(2 / 3);
  });

  test("nothing to verify is a ratio of 1 (same convention as validateCitations)", () => {
    expect(verbatimRatio([])).toBe(1);
  });
});
