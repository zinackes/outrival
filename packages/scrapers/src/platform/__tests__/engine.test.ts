import { test, expect } from "bun:test";
import { matchFingerprints, type MatchInput } from "../wappalyzer/engine";
import type { TechCatalog } from "../wappalyzer/types";

const empty = (over: Partial<MatchInput> = {}): MatchInput => ({
  html: "",
  headers: {},
  scriptSrc: [],
  cookies: {},
  meta: {},
  js: {},
  cname: [],
  ...over,
});

const catalog: TechCatalog = {
  Vercel: { cats: [62], headers: { "x-vercel-id": "" } },
  "Next.js": { cats: [18], html: ["/_next/static/"], implies: ["React"] },
  React: { cats: [12] },
  Segment: { cats: [10], scriptSrc: ["cdn\\.segment\\.com"], js: { analytics: "" } },
  Ghost: { cats: [1], meta: { generator: "Ghost(?:\\s([\\d.]+))?\\;version:\\1" } },
};

test("matches a header presence signal", () => {
  const out = matchFingerprints(empty({ headers: { "x-vercel-id": "abc" } }), catalog);
  const vercel = out.find((d) => d.tech === "Vercel");
  expect(vercel).toBeDefined();
  expect(vercel?.evidence).toContain("header:x-vercel-id");
});

test("matches an html regex signal", () => {
  const out = matchFingerprints(empty({ html: "<script>/_next/static/chunks</script>" }), catalog);
  expect(out.some((d) => d.tech === "Next.js")).toBe(true);
});

test("matches a scriptSrc pattern and a js global", () => {
  const out = matchFingerprints(
    empty({ scriptSrc: ["https://cdn.segment.com/analytics.js/v1/x/analytics.min.js"], js: { analytics: {} } }),
    catalog,
  );
  const seg = out.find((d) => d.tech === "Segment");
  expect(seg).toBeDefined();
  // two corroborating signals → high confidence
  expect(seg?.confidence).toBe("high");
  expect(seg?.evidence.length).toBe(2);
});

test("parses meta version suffix without breaking the regex", () => {
  const out = matchFingerprints(
    empty({ meta: { generator: "Ghost 5.2" } }),
    catalog,
  );
  expect(out.some((d) => d.tech === "Ghost")).toBe(true);
});

test("adds implied techs with implied-by evidence", () => {
  const out = matchFingerprints(empty({ html: "/_next/static/" }), catalog);
  const react = out.find((d) => d.tech === "React");
  expect(react).toBeDefined();
  expect(react?.evidence).toContain("implied-by:Next.js");
});

test("empty input detects nothing", () => {
  expect(matchFingerprints(empty(), catalog)).toEqual([]);
});

test("an invalid regex pattern never matches (no throw)", () => {
  const bad: TechCatalog = { Bad: { cats: [1], html: ["("] } };
  expect(matchFingerprints(empty({ html: "anything (" }), bad)).toEqual([]);
});
