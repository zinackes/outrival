import { test, expect } from "bun:test";
import { SOURCE_TYPES } from "./constants/sources";
import {
  validateReviewUrl,
  isReviewSource,
  isRotatingListSource,
  REVIEW_SOURCE_TYPES,
  parseTrustpilotSnapshot,
  parseAppStoreSnapshot,
  parseShopifyAppUrl,
  parseShopifyReviewsSnapshot,
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

// ─── Shopify App Store (2026-08-04) ──────────────────────────────────────────

test("shopify: a listing URL passes, with or without the /reviews path", () => {
  expect(validateReviewUrl("shopify_reviews", "https://apps.shopify.com/klaviyo").ok).toBe(true);
  expect(parseShopifyAppUrl("https://apps.shopify.com/klaviyo/reviews?page=2")).toEqual({
    handle: "klaviyo",
  });
});

test("shopify: another host, a store path or no handle at all are rejected", () => {
  // Brand mismatch (SSRF + wrong-site guard).
  expect(validateReviewUrl("shopify_reviews", "https://acme.com/klaviyo").ok).toBe(false);
  expect(validateReviewUrl("shopify_reviews", "https://apps.shopify.com/").ok).toBe(false);
  // The store's own furniture: a category page is a listing of listings, and
  // monitoring it would report its rating as a competitor's.
  expect(parseShopifyAppUrl("https://apps.shopify.com/categories/marketing")).toBeNull();
  // Handles are lowercase kebab slugs; anything else is a path we don't know.
  expect(parseShopifyAppUrl("https://apps.shopify.com/Klaviyo_App")).toBeNull();
});

test("shopify: the listing-wide aggregate wins over the mean of the captured window", () => {
  // `sort_by=newest` returns whoever wrote in last, so its mean is not the rating the
  // store displays — the same skew the App Store parser guards against.
  const snap = JSON.stringify({
    source: "shopify",
    handle: "klaviyo",
    averageRating: 4.7,
    ratingCount: 2940,
    distribution: [{ stars: 5, count: 2599 }],
    reviews: [
      { id: "2", rating: 1, content: "billed twice", author: "a", country: "US", updated: "", tenure: "" },
      { id: "1", rating: 1, content: "slow editor", author: "b", country: "DE", updated: "", tenure: "" },
    ],
  });
  const out = parseShopifyReviewsSnapshot(snap)!;
  expect(out.averageScore).toBe(4.7);
  expect(out.reviewCount).toBe(2940);
  expect(out.text).toContain("billed twice");
});

test("shopify: a star-only window still carries the rating the tab is built on", () => {
  const snap = JSON.stringify({
    source: "shopify",
    handle: "acme",
    averageRating: 4.2,
    ratingCount: 130,
    distribution: [],
    reviews: [],
  });
  expect(parseShopifyReviewsSnapshot(snap)).toEqual({
    averageScore: 4.2,
    reviewCount: 130,
    text: "",
  });
});

test("shopify: another source's snapshot is not parsed as one of ours", () => {
  const appStore = JSON.stringify({ source: "appstore", appId: "1", countries: [], reviews: [] });
  expect(parseShopifyReviewsSnapshot(appStore)).toBeNull();
  expect(parseShopifyReviewsSnapshot("not json")).toBeNull();
});

test("isReviewSource: App Store and Shopify are review sources, retired aggregators are not", () => {
  expect(isReviewSource("appstore_reviews")).toBe(true);
  expect(isReviewSource("shopify_reviews")).toBe(true);
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
