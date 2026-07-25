import { describe, expect, test } from "bun:test";

import { collapsePositioningVersions } from "../src/routes/competitors";

// A homepage is scraped daily and rewritten a handful of times a year, so the
// value of this endpoint is entirely in the collapse: without it the response is
// hundreds of identical rows, and with a wrong one the Positioning tab shows a
// rewrite on a date nothing happened.

const hero = (headline: string, subheadline?: string) => ({
  hero: { headline, subheadline },
  sections: [],
});

const at = (iso: string) => new Date(iso);

describe("collapsePositioningVersions", () => {
  test("consecutive identical captures collapse into one version", () => {
    const versions = collapsePositioningVersions([
      { structure: hero("Track everything"), scrapedAt: at("2026-07-20T00:00:00Z") },
      { structure: hero("Track everything"), scrapedAt: at("2026-07-19T00:00:00Z") },
      { structure: hero("Track everything"), scrapedAt: at("2026-07-18T00:00:00Z") },
    ]);

    expect(versions).toHaveLength(1);
    expect(versions[0]!.headline).toBe("Track everything");
  });

  test("capturedAt is when the wording FIRST appeared, not when it was last seen", () => {
    // Walked newest to oldest, so the newest capture of a version is met first and
    // the timestamp has to be corrected downward. Stamping the newest capture
    // instead would date the rewrite to today for a headline that has been up for
    // a week, and the pair would read as a change that never happened then.
    const versions = collapsePositioningVersions([
      { structure: hero("Buy, sell, trade"), scrapedAt: at("2026-07-20T00:00:00Z") },
      { structure: hero("Buy, sell, trade"), scrapedAt: at("2026-07-15T00:00:00Z") },
      { structure: hero("Track your collection"), scrapedAt: at("2026-07-14T00:00:00Z") },
      { structure: hero("Track your collection"), scrapedAt: at("2026-05-02T00:00:00Z") },
    ]);

    expect(versions).toHaveLength(2);
    expect(versions[0]!.capturedAt).toBe("2026-07-15T00:00:00.000Z");
    expect(versions[1]!.capturedAt).toBe("2026-05-02T00:00:00.000Z");
  });

  test("a headline that reverts counts as a new version, not the old one", () => {
    // Only CONSECUTIVE captures collapse. A competitor that goes A, B, A really
    // did change twice, and folding the two A's together would erase the B.
    const versions = collapsePositioningVersions([
      { structure: hero("A"), scrapedAt: at("2026-07-20T00:00:00Z") },
      { structure: hero("B"), scrapedAt: at("2026-07-10T00:00:00Z") },
      { structure: hero("A"), scrapedAt: at("2026-07-01T00:00:00Z") },
    ]);

    expect(versions.map((v) => v.headline)).toEqual(["A", "B", "A"]);
  });

  test("a subheadline change alone opens a version", () => {
    const versions = collapsePositioningVersions([
      { structure: hero("Same", "Now with trading"), scrapedAt: at("2026-07-20T00:00:00Z") },
      { structure: hero("Same", "Just tracking"), scrapedAt: at("2026-07-10T00:00:00Z") },
    ]);

    expect(versions).toHaveLength(2);
  });

  test("value props are compared, and template labels never enter them", () => {
    // positioningCopyOf drops any heading recurring 3+ times: a stepped layout
    // repeats one mockup label across every panel. If that filtering differed
    // between two captures the diff would invent a change, which is why the
    // derivation is shared with the fact sheet rather than re-implemented.
    const withRepeats = {
      hero: { headline: "Same" },
      sections: [
        { type: "features", heading: "Real-time pricing" },
        { type: "features", heading: "Product Brief" },
        { type: "features", heading: "Product Brief" },
        { type: "features", heading: "Product Brief" },
      ],
    };
    const versions = collapsePositioningVersions([
      { structure: withRepeats, scrapedAt: at("2026-07-20T00:00:00Z") },
      {
        structure: {
          hero: { headline: "Same" },
          sections: [{ type: "features", heading: "Real-time pricing" }],
        },
        scrapedAt: at("2026-07-10T00:00:00Z"),
      },
    ]);

    // Identical once the repeated template label is filtered out, so one version.
    expect(versions).toHaveLength(1);
    expect(versions[0]!.valueProps).toEqual(["Real-time pricing"]);
  });

  test("captures with no stored structure are skipped, not counted as a rewrite", () => {
    const versions = collapsePositioningVersions([
      { structure: hero("A"), scrapedAt: at("2026-07-20T00:00:00Z") },
      { structure: null, scrapedAt: at("2026-07-15T00:00:00Z") },
      { structure: hero("A"), scrapedAt: at("2026-07-10T00:00:00Z") },
    ]);

    expect(versions).toHaveLength(1);
    expect(versions[0]!.capturedAt).toBe("2026-07-10T00:00:00.000Z");
  });

  test("the version cap bounds the response", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      structure: hero(`Headline ${i}`),
      scrapedAt: at(`2026-07-${String(28 - i).padStart(2, "0")}T00:00:00Z`),
    }));

    expect(collapsePositioningVersions(rows, 5)).toHaveLength(5);
  });
});
