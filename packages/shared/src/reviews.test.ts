import { test, expect } from "bun:test";
import { SOURCE_TYPES } from "./constants/sources";
import {
  validateReviewUrl,
  isReviewSource,
  isRotatingListSource,
  REVIEW_SOURCE_TYPES,
  parseTrustpilotSnapshot,
  parseAppStoreSnapshot,
} from "./reviews";

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

test("parseAppStoreSnapshot: score + count come from the store-wide aggregate, not the recent sample", () => {
  // Recent reviews mean 2.0 (post-update complainers), but the store shows 4.77 / 6302.
  const snap = JSON.stringify({
    source: "appstore",
    appId: "618783545",
    countries: ["us"],
    averageUserRating: 4.77055,
    userRatingCount: 6302,
    reviews: [
      { id: "a", rating: 1, title: "bug", content: "broke after update", author: "x", updated: "" },
      { id: "b", rating: 3, title: "meh", content: "ok", author: "y", updated: "" },
    ],
  });
  const out = parseAppStoreSnapshot(snap)!;
  expect(out.averageScore).toBe(4.77); // aggregate, rounded to 2dp — NOT the 2.0 sample mean
  expect(out.reviewCount).toBe(6302); // total ratings — NOT the 2 verbatims fetched
  expect(out.text).toContain("broke after update"); // verbatims still drive AI extraction
});

test("parseAppStoreSnapshot: an entry-less feed still carries the aggregate", () => {
  // Observed in prod (2026-07-29): from the worker the RSS returns no verbatims while
  // the Lookup aggregate resolves, so the stored snapshot is 124 bytes. The rating and
  // the count are still there, and extract-reviews records them rather than treating
  // the capture as empty.
  const snap = JSON.stringify({
    source: "appstore",
    appId: "784907999",
    countries: ["us"],
    averageUserRating: 4.54669,
    userRatingCount: 2506,
    reviews: [],
  });
  const out = parseAppStoreSnapshot(snap)!;
  expect(out.averageScore).toBe(4.55);
  expect(out.reviewCount).toBe(2506);
  expect(out.text).toBe(""); // no verbatims to hand the model
});

test("parseAppStoreSnapshot: falls back to the recent-sample mean when the aggregate is absent", () => {
  // Pre-aggregate snapshot (or a failed lookup) → the old behaviour: mean of the sample.
  const snap = JSON.stringify({
    source: "appstore",
    appId: "1",
    countries: ["us"],
    reviews: [
      { id: "a", rating: 5, title: "", content: "great", author: "x", updated: "" },
      { id: "b", rating: 4, title: "", content: "good", author: "y", updated: "" },
    ],
  });
  const out = parseAppStoreSnapshot(snap)!;
  expect(out.averageScore).toBe(4.5);
  expect(out.reviewCount).toBe(2);
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

// Every signal a review-source lexical diff ever produced in prod said the same
// wrong thing: the list rotated. Suppressing that path is only safe if the
// predicate covers every review source the enum has — including the aggregators
// retired from REVIEW_SOURCE_TYPES but still running on monitors created before.
test("isRotatingListSource covers every review source in the enum", () => {
  const reviewSources = SOURCE_TYPES.filter((s) => s.endsWith("_reviews"));
  expect(reviewSources.length).toBeGreaterThan(1);
  for (const s of reviewSources) expect(isRotatingListSource(s)).toBe(true);
  // The narrower set names what a user may enable today; it is NOT the set whose
  // captures rotate, and keying the suppression on it would leave the g2 and
  // capterra monitors prod still runs producing the same false signals.
  expect(REVIEW_SOURCE_TYPES.length).toBeLessThan(reviewSources.length);
});

test("isRotatingListSource leaves document sources alone", () => {
  for (const s of ["homepage", "pricing", "blog", "changelog", "jobs", "docs"] as const) {
    expect(isRotatingListSource(s)).toBe(false);
  }
  // A score-and-count surface with no verbatim list does not rotate.
  expect(isRotatingListSource("trustpilot_public")).toBe(false);
});
