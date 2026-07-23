import { expect, test } from "bun:test";
import { dedupeByDomain } from "../discover";

const c = (url: string, snippet = "") => ({ url, title: url, snippet });

test("same company from three sources collapses to one entry", () => {
  const out = dedupeByDomain(
    [c("https://netlify.com/", "exa text"), c("https://www.netlify.com/pricing"), c("https://netlify.com")],
    new Set(),
  );
  expect(out).toHaveLength(1);
  expect(out[0]!.url).toBe("https://netlify.com/");
});

test("first occurrence wins — source order is the priority order", () => {
  const out = dedupeByDomain([c("https://a.com", "first"), c("https://b.com")], new Set());
  expect(out.map((r) => r.url)).toEqual(["https://a.com", "https://b.com"]);
});

test("a snippet-less seed is upgraded by a later source's text", () => {
  const out = dedupeByDomain([c("https://render.com"), c("https://www.render.com", "exa text")], new Set());
  expect(out).toHaveLength(1);
  expect(out[0]!.url).toBe("https://render.com");
  expect(out[0]!.snippet).toBe("exa text");
});

test("excluded domains are dropped whatever the URL shape", () => {
  const out = dedupeByDomain(
    [c("https://www.vercel.com/pricing"), c("https://netlify.com")],
    new Set(["vercel.com"]),
  );
  expect(out.map((r) => r.url)).toEqual(["https://netlify.com"]);
});

test("unparseable URLs are dropped, not kept under an empty key", () => {
  // A dotless label still parses as a host (extractHostname prefixes https://) —
  // it survives here and dies at the liveness check, like any dead domain.
  const out = dedupeByDomain([c("not a url"), c("https://ok.com")], new Set());
  expect(out.map((r) => r.url)).toEqual(["https://ok.com"]);
});
