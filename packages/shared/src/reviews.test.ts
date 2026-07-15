import { test, expect } from "bun:test";
import { validateReviewUrl, isReviewSource, parseTrustpilotSnapshot } from "./reviews";

// ─── Reviews v2 (2026-07-15) ─────────────────────────────────────────────────
// Scraped aggregators (g2/capterra/trustpilot/trustradius/gartner/playstore) are
// retired for legal reasons. App Store (public RSS) is the only user-selectable
// review source read directly; Trustpilot survives as the surface-only
// `trustpilot_public` (no user URL, so not a REVIEW_SOURCE_TYPE).

test("appstore: a real review URL with an app id passes", () => {
  expect(
    validateReviewUrl("appstore_reviews", "https://apps.apple.com/us/app/slack/id618783545"),
  ).toEqual({ ok: true, url: "https://apps.apple.com/us/app/slack/id618783545" });
});

test("appstore: brand mismatch and missing app id are rejected (SSRF / wrong-site guard)", () => {
  expect(validateReviewUrl("appstore_reviews", "https://acme.com/fake").ok).toBe(false);
  // apple host but no /id<digits> → rejected
  expect(validateReviewUrl("appstore_reviews", "https://apps.apple.com/us/app/slack").ok).toBe(false);
});

test("non-https review URLs are rejected", () => {
  expect(validateReviewUrl("appstore_reviews", "http://apps.apple.com/us/app/slack/id618783545").ok).toBe(false);
});

test("parseTrustpilotSnapshot extracts the score + count, rejects the wrong shape", () => {
  const snap = JSON.stringify({
    source: "trustpilot",
    domain: "acme.com",
    businessUnitId: "bu-1",
    trustScore: 4.2,
    stars: 4,
    reviewCount: 512,
    distribution: [],
  });
  expect(parseTrustpilotSnapshot(snap)).toEqual({ trustScore: 4.2, reviewCount: 512 });
  // an App Store snapshot (different source) is not a Trustpilot snapshot
  expect(parseTrustpilotSnapshot(JSON.stringify({ source: "appstore", reviews: [] }))).toBeNull();
  expect(parseTrustpilotSnapshot("not json")).toBeNull();
});

test("isReviewSource: App Store is a review source, retired aggregators are not", () => {
  expect(isReviewSource("appstore_reviews")).toBe(true);
  for (const s of [
    "g2_reviews",
    "capterra_reviews",
    "trustpilot_reviews",
    "trustradius_reviews",
    "gartner_reviews",
    "playstore_reviews",
    "trustpilot_public",
    "homepage",
  ] as const) {
    expect(isReviewSource(s)).toBe(false);
  }
});
