import { test, expect } from "bun:test";
import { replayExtractor } from "../cached-extractor";
import type { ExtractorSpec } from "@outrival/shared";

test("replays a list spec into rows, applying transforms", () => {
  const html = `<ul class="jobs">
    <li class="job"><h3 class="t">Backend Engineer</h3><span class="d">Engineering</span><span class="l">Paris</span></li>
    <li class="job"><h3 class="t">AE</h3><span class="d">Sales</span></li>
  </ul>`;
  const spec: ExtractorSpec = {
    version: 1,
    list: "ul.jobs li.job",
    fields: {
      title: { selector: "h3.t" },
      department: { selector: "span.d" },
      location: { selector: "span.l", nullable: true },
    },
  };
  expect(replayExtractor(html, spec)).toEqual([
    { title: "Backend Engineer", department: "Engineering", location: "Paris" },
    { title: "AE", department: "Sales", location: null },
  ]);
});

test("number transform strips currency and parses a float", () => {
  const html = `<div class="card"><span class="name">Pro</span><span class="price">$29.00/mo</span></div>`;
  const spec: ExtractorSpec = {
    version: 1,
    list: "div.card",
    fields: {
      plan_name: { selector: "span.name" },
      price: { selector: "span.price", transform: "number" },
    },
  };
  expect(replayExtractor(html, spec)).toEqual([{ plan_name: "Pro", price: 29 }]);
});

test("drops a row when a required field is missing, keeps it with a default", () => {
  const html = `<ul><li class="r"><span class="a">x</span></li><li class="r"><span class="b">y</span></li></ul>`;
  const spec: ExtractorSpec = {
    version: 1,
    list: "li.r",
    fields: {
      a: { selector: "span.a" }, // required
      b: { selector: "span.b", default: "Other" },
    },
  };
  // First row: a="x", b missing → default "Other". Second row: a missing → dropped.
  expect(replayExtractor(html, spec)).toEqual([{ a: "x", b: "Other" }]);
});

test("no-list spec returns a single object at document scope", () => {
  const html = `<div><span class="score">4.6</span><span class="count">1,234</span></div>`;
  const spec: ExtractorSpec = {
    version: 1,
    fields: {
      average_score: { selector: "span.score", transform: "number" },
      review_count: { selector: "span.count", transform: "number" },
    },
  };
  expect(replayExtractor(html, spec)).toEqual({ average_score: 4.6, review_count: 1234 });
});

test("reads an attribute when attr is set", () => {
  const html = `<div class="card"><a class="link" href="/pro">Pro</a></div>`;
  const spec: ExtractorSpec = {
    version: 1,
    list: "div.card",
    fields: { url: { selector: "a.link", attr: "href" } },
  };
  expect(replayExtractor(html, spec)).toEqual([{ url: "/pro" }]);
});
