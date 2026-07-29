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

// The Buffer inversion (signal ec473eef, 2026-07-28). Buffer replaced its hero
// copy: the per-channel pitch was DELETED, a generic one took its place. The
// insight reported the deleted line as an announcement, and because the fuzzy pass
// searched the whole diff — deleted text included — it scored verbatim, ratio 1,
// zero judge calls, and published as a `high` alert.
const LABELLED_CHANGE = `<removed> is text the page NO LONGER shows. <added> is text the page NOW shows.
<removed>
Only pay for the channels you use
For solo creators through to multi-brand agencies. Add channels as you grow, remove them when you don't.
</removed>
<added>
Flexible pricing for everyone
</added>`;

describe("isClaimSupported — labelled change polarity", () => {
  test("a quote lifted from the DELETED side is not free support", () => {
    expect(
      isClaimSupported(
        {
          text: "Buffer announced a shift to flexible, per-channel pricing.",
          citedQuote: "Only pay for the channels you use",
        },
        LABELLED_CHANGE,
      ),
    ).toBe(false);
  });

  test("a quote from the LIVE side is supported exactly as before", () => {
    expect(
      isClaimSupported(
        {
          text: "Buffer's pricing page now leads with a broad message.",
          citedQuote: "Flexible pricing for everyone",
        },
        LABELLED_CHANGE,
      ),
    ).toBe(true);
  });

  test("a continuation line of a multi-line deleted hunk is not support either", () => {
    // The line that carried no marker before per-line prefixing. It has a side now.
    expect(
      isClaimSupported(
        {
          text: "Buffer lets users add channels as they grow.",
          citedQuote: "Add channels as you grow, remove them when you don't.",
        },
        LABELLED_CHANGE,
      ),
    ).toBe(false);
  });

  test("a pure deletion supports nothing on the fuzzy pass — every claim is judged", () => {
    const deletionOnly = `<removed>\nSOC 2 Type II certified\n</removed>`;
    expect(
      isClaimSupported(
        { text: "The competitor is SOC 2 Type II certified.", citedQuote: "SOC 2 Type II certified" },
        deletionOnly,
      ),
    ).toBe(false);
  });

  test("an unlabelled source is untouched — battle cards and digests behave as before", () => {
    expect(
      isClaimSupported({ text: "Starter costs $49/month.", citedQuote: "Starter — $49/month" }, SOURCE),
    ).toBe(true);
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
