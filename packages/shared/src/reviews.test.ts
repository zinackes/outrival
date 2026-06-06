import { test, expect } from "bun:test";
import { validateReviewUrl, parsePlayStoreUrl, isReviewSource } from "./reviews";

// ─── multi-platform review URL validation (patch-32) ─────────────────────────

test("trustpilot: a real review URL passes, a brand mismatch is rejected", () => {
  expect(validateReviewUrl("trustpilot_reviews", "https://www.trustpilot.com/review/acme.com")).toEqual({
    ok: true,
    url: "https://www.trustpilot.com/review/acme.com",
  });
  // SSRF / wrong-site guard: brand must match.
  expect(validateReviewUrl("trustpilot_reviews", "https://acme.com/fake").ok).toBe(false);
});

test("trustradius and gartner brand-match", () => {
  expect(validateReviewUrl("trustradius_reviews", "https://www.trustradius.com/products/acme/reviews").ok).toBe(true);
  expect(validateReviewUrl("gartner_reviews", "https://www.gartner.com/reviews/market/x/vendor/acme").ok).toBe(true);
  expect(validateReviewUrl("gartner_reviews", "https://g2.com/products/acme").ok).toBe(false);
});

test("playstore: requires a package id and the google brand", () => {
  expect(
    validateReviewUrl("playstore_reviews", "https://play.google.com/store/apps/details?id=com.acme.app"),
  ).toEqual({ ok: true, url: "https://play.google.com/store/apps/details?id=com.acme.app" });
  // missing ?id → rejected
  expect(validateReviewUrl("playstore_reviews", "https://play.google.com/store/apps/details").ok).toBe(false);
  // wrong host
  expect(validateReviewUrl("playstore_reviews", "https://apps.apple.com/app/id123").ok).toBe(false);
});

test("non-https review URLs are rejected", () => {
  expect(validateReviewUrl("trustpilot_reviews", "http://www.trustpilot.com/review/acme.com").ok).toBe(false);
});

test("parsePlayStoreUrl extracts the package id", () => {
  expect(parsePlayStoreUrl("https://play.google.com/store/apps/details?id=com.acme.app")).toEqual({
    appId: "com.acme.app",
  });
  expect(parsePlayStoreUrl("https://play.google.com/store/apps/details")).toBeNull();
});

test("isReviewSource recognizes the new platforms", () => {
  for (const s of ["trustpilot_reviews", "trustradius_reviews", "gartner_reviews", "playstore_reviews"] as const) {
    expect(isReviewSource(s)).toBe(true);
  }
  expect(isReviewSource("homepage")).toBe(false);
});
