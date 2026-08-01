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

// The parser reads the hero off `$("h1").first()` alone, so a page that titles in an
// <h2> or a styled <div> yields headline AND subheadline null together and the whole
// "How they position" section vanishes. Measured on prod 2026-08-01: 9 of 158 stored
// structures, all of them live, fully-parsed pages. The cases below are those pages.
describe("positioningCopyOf — <head> fallback when a page has no H1", () => {
  const copyOf = (structure: unknown) =>
    collapsePositioningVersions([{ structure, scrapedAt: at("2026-08-01T00:00:00Z") }])[0]!;

  test("recovers og:title and og:description when the hero came back empty", () => {
    // asista.com: 150 KB, 37 sections, 16 customer logos parsed, no <h1> anywhere.
    const v = copyOf({
      hero: { headline: null, subheadline: null },
      sections: [],
      title: "AiDi - Asista",
      openGraph: {
        title: "AiDi - Asista",
        description: "Asista AIDI transforms manufacturing operations by turning data into decisions.",
      },
    });

    expect(v.headline).toBe("AiDi - Asista");
    expect(v.subheadline).toBe(
      "Asista AIDI transforms manufacturing operations by turning data into decisions.",
    );
  });

  test("falls back to <title> and meta description when there are no og: tags", () => {
    // rimworldgame.com ships a meta description and no og:title.
    const v = copyOf({
      hero: { headline: null, subheadline: null },
      sections: [],
      title: "RimWorld - Sci-Fi Colony Sim",
      metaDescription: "A sci-fi colony sim driven by an intelligent AI storyteller.",
    });

    expect(v.headline).toBe("RimWorld - Sci-Fi Colony Sim");
    expect(v.subheadline).toBe("A sci-fi colony sim driven by an intelligent AI storyteller.");
  });

  test("site-builder boilerplate never becomes positioning copy", () => {
    // api360.sa ships Framer's default og:description. Printing it would tell the
    // reader which page builder the competitor bought, dressed as their pitch.
    const v = copyOf({
      hero: { headline: null, subheadline: null },
      sections: [],
      title: "API360 for banks",
      openGraph: { description: "Made with Framer" },
    });

    expect(v.headline).toBe("API360 for banks");
    expect(v.subheadline).toBeNull();
  });

  test("a parked or stopped host page is not a positioning statement", () => {
    // krysp.io resolves to its host's stopped-site page.
    const v = copyOf({
      hero: { headline: null, subheadline: null },
      sections: [],
      title: "Sorry, the website has been stopped",
    });

    expect(v.headline).toBeNull();
    expect(v.subheadline).toBeNull();
  });

  test("a bare brand token is not a headline", () => {
    // The company name is the one thing the reader already knows; surfacing it as
    // their positioning fills the section while saying nothing.
    const v = copyOf({
      hero: { headline: null, subheadline: null },
      sections: [],
      title: "API360",
      openGraph: { title: "API360" },
    });

    expect(v.headline).toBeNull();
  });

  test("keyword-stuffed <head> text is dropped, never truncated into a sentence", () => {
    const v = copyOf({
      hero: { headline: null, subheadline: null },
      sections: [],
      title: `${"web scraping api proxy rotation ".repeat(12)}`,
    });

    expect(v.headline).toBeNull();
  });

  test("a real hero headline is never overwritten, and gains no invented subheadline", () => {
    // 66 of the 158 carry a headline with no subheadline. They already render the
    // section, so splicing a meta description under their real H1 would rewrite copy
    // for 42% of the roster to reach the 6% that shows nothing.
    const v = copyOf({
      hero: { headline: "Ship faster than your competition" },
      sections: [],
      title: "Acme | The developer platform",
      openGraph: { description: "Acme is the platform teams use to ship." },
    });

    expect(v.headline).toBe("Ship faster than your competition");
    expect(v.subheadline).toBeNull();
  });

  test("the same string is not printed twice as headline and subheadline", () => {
    // <title> and meta description are routinely identical; showing both reads as a
    // rendering bug rather than as two things the competitor wrote.
    const v = copyOf({
      hero: { headline: null, subheadline: null },
      sections: [],
      title: "The ultimate recruitment software",
      metaDescription: "The ultimate recruitment software",
    });

    expect(v.headline).toBe("The ultimate recruitment software");
    expect(v.subheadline).toBeNull();
  });

  test("the fallback does not read as a rewrite across captures", () => {
    // It derives from stored fields, so every capture ever taken resolves the same
    // way. If it ran only on the newest one, the Positioning tab would date a
    // messaging change to the day this shipped.
    const structure = {
      hero: { headline: null, subheadline: null },
      sections: [],
      openGraph: { title: "AiDi - Asista", description: "Turning plant data into decisions." },
    };
    const versions = collapsePositioningVersions([
      { structure, scrapedAt: at("2026-08-01T00:00:00Z") },
      { structure, scrapedAt: at("2026-06-01T00:00:00Z") },
    ]);

    expect(versions).toHaveLength(1);
    expect(versions[0]!.capturedAt).toBe("2026-06-01T00:00:00.000Z");
  });
});
