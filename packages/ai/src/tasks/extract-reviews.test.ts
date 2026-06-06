import { test, expect } from "bun:test";
import { ReviewsSchema } from "./extract-reviews";

// Backward compatibility: an output predating patch-32 (no sub_scores / themes)
// must still parse, defaulting the new fields — otherwise every cached/older
// extraction would fail validation.
test("parses a pre-patch-32 output, defaulting the new fields", () => {
  const parsed = ReviewsSchema.parse({
    average_score: 4.5,
    review_count: 1200,
    sentiment_score: 78,
    top_praises: ["Intuitive"],
    top_complaints: ["Pricey"],
  });
  expect(parsed.sub_scores).toBeNull();
  expect(parsed.complaint_themes).toEqual([]);
});

test("parses sub_scores and complaint_themes when present", () => {
  const parsed = ReviewsSchema.parse({
    average_score: 4.2,
    review_count: 50,
    sentiment_score: 60,
    top_praises: [],
    top_complaints: ["No SSO"],
    sub_scores: { ease_of_use: 4.6, support: 4.1, features: 4.3, value: 3.8 },
    complaint_themes: [{ theme: "Missing SSO", prevalence: "high" }],
  });
  expect(parsed.sub_scores?.support).toBe(4.1);
  expect(parsed.complaint_themes[0]).toEqual({ theme: "Missing SSO", prevalence: "high" });
});

test("rejects an out-of-range sub-score and an invalid prevalence", () => {
  expect(
    ReviewsSchema.safeParse({
      average_score: null,
      review_count: null,
      sentiment_score: 50,
      top_praises: [],
      top_complaints: [],
      sub_scores: { ease_of_use: 9, support: null, features: null, value: null },
    }).success,
  ).toBe(false);
  expect(
    ReviewsSchema.safeParse({
      average_score: null,
      review_count: null,
      sentiment_score: 50,
      top_praises: [],
      top_complaints: [],
      complaint_themes: [{ theme: "x", prevalence: "huge" }],
    }).success,
  ).toBe(false);
});
