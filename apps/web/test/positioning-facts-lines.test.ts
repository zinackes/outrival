import { test, expect, describe } from "bun:test";
import type { PositioningFacts } from "../src/lib/api";
import { deriveLines } from "../src/components/outrival/battle-card/positioning";

/**
 * Positioning Intelligence v2 P4 — the battle-card section is rendered from facts,
 * one line per fact, and a missing fact drops its line.
 *
 * This is the property the 2026-07-10 audit was written about: filler for absent
 * evidence ("not captured", "n/a") reached the model and came back as a competitor
 * weakness. A deterministic section cannot make that mistake through a model, but
 * it can make it through a template — so every line here is asserted to be ABSENT,
 * not empty, when its fact is null.
 */

const NONE: PositioningFacts = {
  tagline: null,
  claims: [],
  comparison: null,
  icp: null,
  namedByCount: 0,
};

const facts = (over: Partial<PositioningFacts>): PositioningFacts => ({ ...NONE, ...over });

describe("a missing fact drops its line", () => {
  test("nothing captured produces no lines at all, so the section hides", () => {
    expect(deriveLines(NONE, "Crayon")).toEqual([]);
  });

  test("an ICP alone produces exactly one line", () => {
    const lines = deriveLines(
      facts({ icp: { personas: ["Agencies"], industries: [], industriesProven: false } }),
      "Crayon",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Agencies");
  });

  test("a tagline alone produces exactly one line", () => {
    const lines = deriveLines(
      facts({
        tagline: {
          h1: "Win more deals",
          capturedAt: "2026-07-12T00:00:00.000Z",
          primaryCta: null,
          previousH1: null,
        },
      }),
      "Crayon",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Win more deals");
    // No previous wording captured: the sentence must not claim a rewrite.
    expect(lines[0]).not.toContain("replaced");
  });
});

describe("the lines say what the data says", () => {
  test("a rewrite names the wording it replaced", () => {
    const [line] = deriveLines(
      facts({
        tagline: {
          h1: "After",
          capturedAt: "2026-07-12T00:00:00.000Z",
          primaryCta: "Book a demo",
          previousH1: "Before",
        },
      }),
      "Crayon",
    );
    expect(line).toContain("“After”");
    expect(line).toContain("It replaced “Before”");
    expect(line).toContain("Book a demo");
  });

  test("claims are quoted verbatim, never restated", () => {
    const [line] = deriveLines(
      facts({
        claims: [
          { rawText: "Trusted by 15,000 go-to-market teams", observedAt: "2026-08-01" },
          { rawText: "99.9% uptime, backed by an SLA", observedAt: "2026-07-02" },
        ],
      }),
      "Crayon",
    );
    expect(line).toContain("“Trusted by 15,000 go-to-market teams”");
    expect(line).toContain("“99.9% uptime, backed by an SLA”");
  });

  test("a total larger than the named list still states the total", () => {
    const [line] = deriveLines(
      facts({
        comparison: { recent: ["Klue"], named: ["Klue"], total: 9, windowDays: 90 },
      }),
      "Crayon",
    );
    expect(line).toContain("Klue");
    expect(line).toContain("9 named in total");
    expect(line).toContain("1 in the last 90 days");
  });

  test("a map with no recent front says so rather than implying one", () => {
    const [line] = deriveLines(
      facts({ comparison: { recent: [], named: [], total: 4, windowDays: 90 } }),
      "Crayon",
    );
    expect(line).toContain("4 rivals");
    expect(line).toContain("none in the last 90 days");
  });

  test("proven verticals and declared ones are different sentences", () => {
    const proven = deriveLines(
      facts({ icp: { personas: [], industries: ["Fintech"], industriesProven: true } }),
      "Crayon",
    )[0];
    const declared = deriveLines(
      facts({ icp: { personas: [], industries: ["Fintech"], industriesProven: false } }),
      "Crayon",
    )[0];
    expect(proven).toContain("case studies in");
    expect(declared).toContain("industry pages for");
    expect(proven).not.toBe(declared);
  });

  test("the cross-reference line agrees in number with its count", () => {
    expect(deriveLines(facts({ namedByCount: 1 }), "Crayon")[0]).toContain(
      "1 competitor you track names Crayon",
    );
    expect(deriveLines(facts({ namedByCount: 3 }), "Crayon")[0]).toContain(
      "3 competitors you track name Crayon",
    );
  });
});
