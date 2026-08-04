import { describe, expect, test } from "bun:test";
import {
  derivePositioningCopy,
  isSameMessaging,
  messagingFingerprint,
  planMessagingVersions,
  type MessagingCapture,
} from "./positioning";

/**
 * Positioning Intelligence v2 P1. Two rules carry the whole timeline: what counts
 * as a change of messaging, and where a version's date comes from. Get the first
 * wrong and the tab fills with copy edits; get the second wrong and it reports
 * rewrites on days nothing happened.
 */

const capture = (
  iso: string,
  headline: string | null,
  extra: { subheadline?: string; cta?: string } = {},
): MessagingCapture => ({
  capturedAt: new Date(iso),
  snapshotKey: `snapshots/c/homepage/${iso}`,
  copy: derivePositioningCopy({
    hero: {
      headline,
      subheadline: extra.subheadline ?? null,
      primaryCta: extra.cta ? { text: extra.cta } : null,
    },
    sections: [],
  }),
});

describe("derivePositioningCopy", () => {
  test("reads the hero triple and the value-prop headings", () => {
    const copy = derivePositioningCopy({
      hero: {
        headline: "  Buy, sell, trade  ",
        subheadline: "The marketplace for collectors",
        primaryCta: { text: "Start free", href: "/signup" },
      },
      sections: [
        { type: "features", heading: "Real-time pricing" },
        { type: "pricing", heading: "Plans" },
        { type: "integrations", heading: "Works with your shop" },
      ],
    });

    expect(copy.headline).toBe("Buy, sell, trade");
    expect(copy.primaryCta).toBe("Start free");
    // Only feature/integration headings are positioning; a pricing heading is not.
    expect(copy.valueProps).toEqual(["Real-time pricing", "Works with your shop"]);
  });

  test("a heading repeated across panels is a template label, not a value prop", () => {
    const copy = derivePositioningCopy({
      hero: { headline: "Same" },
      sections: [
        { type: "features", heading: "Real-time pricing" },
        { type: "features", heading: "Product Brief" },
        { type: "features", heading: "Product Brief" },
        { type: "features", heading: "Product Brief" },
      ],
    });

    expect(copy.valueProps).toEqual(["Real-time pricing"]);
  });

  test("an empty hero reads as null, never as an empty string", () => {
    const copy = derivePositioningCopy({ hero: { headline: "   ", subheadline: "" } });
    expect(copy.headline).toBeNull();
    expect(copy.subheadline).toBeNull();
    expect(copy.primaryCta).toBeNull();
  });
});

describe("messagingFingerprint", () => {
  test("case, punctuation and symbols are copy edits, not repositionings", () => {
    const a = derivePositioningCopy({ hero: { headline: "Ship faster, together." } });
    const b = derivePositioningCopy({ hero: { headline: "Ship Faster Together" } });
    expect(isSameMessaging(a, b)).toBe(true);
  });

  test("a hyphen dropped from a compound is still the same words", () => {
    const a = derivePositioningCopy({ hero: { headline: "AI-powered research" } });
    const b = derivePositioningCopy({ hero: { headline: "AI powered research" } });
    expect(isSameMessaging(a, b)).toBe(true);
  });

  test("changing a WORD is a change, however small", () => {
    const a = derivePositioningCopy({ hero: { headline: "Track your collection" } });
    const b = derivePositioningCopy({ hero: { headline: "Track your portfolio" } });
    expect(isSameMessaging(a, b)).toBe(false);
  });

  test("the CTA is part of the key — a demo button replacing a signup button is a GTM move", () => {
    const a = derivePositioningCopy({
      hero: { headline: "Same", primaryCta: { text: "Start free trial" } },
    });
    const b = derivePositioningCopy({
      hero: { headline: "Same", primaryCta: { text: "Book a demo" } },
    });
    expect(isSameMessaging(a, b)).toBe(false);
  });

  test("value props are NOT part of the key", () => {
    // Section headings are renamed constantly on pages whose hero never moves;
    // opening a version for each would bury the rewrites that matter.
    const a = derivePositioningCopy({
      hero: { headline: "Same" },
      sections: [{ type: "features", heading: "Real-time pricing" }],
    });
    const b = derivePositioningCopy({
      hero: { headline: "Same" },
      sections: [{ type: "features", heading: "Live pricing" }],
    });
    expect(messagingFingerprint(a)).toBe(messagingFingerprint(b));
  });
});

describe("planMessagingVersions", () => {
  test("a chain of identical captures plans exactly one version, dated at the FIRST", () => {
    const versions = planMessagingVersions([
      capture("2026-05-02T00:00:00Z", "Track your collection"),
      capture("2026-05-03T00:00:00Z", "Track your collection"),
      capture("2026-05-04T00:00:00Z", "Track your collection"),
    ]);

    expect(versions).toHaveLength(1);
    expect(versions[0]!.capturedAt.toISOString()).toBe("2026-05-02T00:00:00.000Z");
  });

  test("a real rewrite is dated to the capture that first carried it", () => {
    const versions = planMessagingVersions([
      capture("2026-05-02T00:00:00Z", "Track your collection"),
      capture("2026-07-14T00:00:00Z", "Track your collection"),
      capture("2026-07-15T00:00:00Z", "Buy, sell, trade"),
      capture("2026-07-20T00:00:00Z", "Buy, sell, trade"),
    ]);

    expect(versions.map((v) => v.copy.headline)).toEqual([
      "Track your collection",
      "Buy, sell, trade",
    ]);
    expect(versions[1]!.capturedAt.toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });

  test("a copy edit in the middle of a chain opens no version", () => {
    const versions = planMessagingVersions([
      capture("2026-05-02T00:00:00Z", "Ship faster, together."),
      capture("2026-06-02T00:00:00Z", "Ship Faster Together"),
      capture("2026-07-02T00:00:00Z", "ship faster together!"),
    ]);

    expect(versions).toHaveLength(1);
    expect(versions[0]!.copy.headline).toBe("Ship faster, together.");
  });

  test("a headline that reverts is a second change, not the first one again", () => {
    const versions = planMessagingVersions([
      capture("2026-05-01T00:00:00Z", "A"),
      capture("2026-06-01T00:00:00Z", "B"),
      capture("2026-07-01T00:00:00Z", "A"),
    ]);

    expect(versions.map((v) => v.copy.headline)).toEqual(["A", "B", "A"]);
  });

  test("a capture with no headline is skipped, never stored as a blank version", () => {
    // A hero we failed to read is not a company that stopped saying anything, and
    // a blank row in the middle would read as two rewrites where there were none.
    const versions = planMessagingVersions([
      capture("2026-05-01T00:00:00Z", "A"),
      capture("2026-06-01T00:00:00Z", null),
      capture("2026-07-01T00:00:00Z", "A"),
    ]);

    expect(versions).toHaveLength(1);
    expect(versions[0]!.capturedAt.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  test("planning the same chain twice plans the same rows — the backfill is idempotent", () => {
    const chain = [
      capture("2026-05-01T00:00:00Z", "A"),
      capture("2026-06-01T00:00:00Z", "B"),
      capture("2026-06-15T00:00:00Z", "B"),
    ];
    const first = planMessagingVersions(chain);
    const second = planMessagingVersions(chain);

    expect(second.map((v) => v.capturedAt.toISOString())).toEqual(
      first.map((v) => v.capturedAt.toISOString()),
    );
  });

  test("a subheadline change alone opens a version", () => {
    const versions = planMessagingVersions([
      capture("2026-05-01T00:00:00Z", "Same", { subheadline: "Just tracking" }),
      capture("2026-06-01T00:00:00Z", "Same", { subheadline: "Now with trading" }),
    ]);

    expect(versions).toHaveLength(2);
  });
});
