import { test, expect } from "bun:test";
import { extractJsonLd } from "../json-ld";
import {
  pricingFromStructured,
  jobsFromStructured,
  reviewScoresFromStructured,
} from "../mappers";

const ldScript = (json: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(json)}</script></head><body></body></html>`;

test("extractJsonLd flattens @graph and arrays, skips malformed blocks", () => {
  const html = `<html><head>
    <script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "A" }, { "@type": "B" }] })}</script>
    <script type="application/ld+json">{ not valid json }</script>
    <script type="application/ld+json">${JSON.stringify([{ "@type": "C" }])}</script>
  </head></html>`;
  const nodes = extractJsonLd(html);
  const types = nodes.map((n) => n["@type"]);
  expect(types).toContain("A");
  expect(types).toContain("B");
  expect(types).toContain("C");
});

test("jobsFromStructured extracts JobPosting with inferred department + location", () => {
  const html = ldScript([
    {
      "@type": "JobPosting",
      title: "Senior Backend Engineer",
      jobLocation: { "@type": "Place", address: { addressLocality: "Paris", addressCountry: "FR" } },
    },
    {
      "@type": "JobPosting",
      title: "Account Executive",
      jobLocationType: "TELECOMMUTE",
    },
  ]);
  const result = jobsFromStructured(html);
  expect(result).not.toBeNull();
  expect(result?.jobs).toHaveLength(2);
  expect(result?.jobs[0]).toEqual({
    title: "Senior Backend Engineer",
    department: "Engineering",
    location: "Paris, FR",
  });
  expect(result?.jobs[1]).toEqual({
    title: "Account Executive",
    department: "Sales",
    location: "Remote",
  });
});

test("jobsFromStructured returns null without JobPosting markup", () => {
  expect(jobsFromStructured("<html><body>careers</body></html>")).toBeNull();
});

test("pricingFromStructured maps Product offers to plans", () => {
  const html = ldScript({
    "@type": "Product",
    name: "Acme",
    offers: [
      { "@type": "Offer", name: "Pro", price: "29.00", priceCurrency: "USD", priceSpecification: { billingDuration: "P1M" } },
      { "@type": "Offer", name: "Enterprise", priceCurrency: "USD" },
    ],
  });
  const result = pricingFromStructured(html);
  expect(result?.plans).toEqual([
    { plan_name: "Pro", price: 29, currency: "USD", billing_period: "monthly" },
    { plan_name: "Enterprise", price: null, currency: "USD", billing_period: "custom" },
  ]);
});

test("pricingFromStructured unwraps AggregateOffer and dedupes", () => {
  const html = ldScript({
    "@type": "SoftwareApplication",
    name: "Acme",
    offers: {
      "@type": "AggregateOffer",
      offers: [
        { name: "Yearly", price: 290, priceCurrency: "EUR", priceSpecification: { billingDuration: "P1Y" } },
        { name: "Yearly", price: 290, priceCurrency: "EUR", priceSpecification: { billingDuration: "P1Y" } },
      ],
    },
  });
  const result = pricingFromStructured(html);
  expect(result?.plans).toEqual([
    { plan_name: "Yearly", price: 290, currency: "EUR", billing_period: "yearly" },
  ]);
});

test("reviewScoresFromStructured reads a standalone AggregateRating", () => {
  const html = ldScript({ "@type": "AggregateRating", ratingValue: "4.6", reviewCount: "1234" });
  expect(reviewScoresFromStructured(html)).toEqual({ average_score: 4.6, review_count: 1234 });
});

test("reviewScoresFromStructured normalizes a non-/5 scale and reads nested aggregateRating", () => {
  const html = ldScript({
    "@type": "Product",
    name: "Acme",
    aggregateRating: { "@type": "AggregateRating", ratingValue: 92, bestRating: 100, ratingCount: 50 },
  });
  expect(reviewScoresFromStructured(html)).toEqual({ average_score: 4.6, review_count: 50 });
});

test("reviewScoresFromStructured returns null without rating markup", () => {
  expect(reviewScoresFromStructured("<html><body>reviews</body></html>")).toBeNull();
});
