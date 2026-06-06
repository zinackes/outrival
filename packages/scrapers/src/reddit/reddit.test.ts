import { test, expect } from "bun:test";
import { parseRedditSearch, buildRedditDoc, redditSearchUrl } from "./reddit";

const LISTING = {
  kind: "Listing",
  data: {
    children: [
      {
        kind: "t3",
        data: {
          id: "abc",
          name: "t3_abc",
          title: "Acme is overpriced for what it does",
          subreddit: "SaaS",
          score: 42,
          num_comments: 17,
          permalink: "/r/SaaS/comments/abc/acme/",
          created_utc: 1714560000,
          selftext: "We switched away because the pricing kept climbing.",
        },
      },
      {
        kind: "t3",
        data: {
          id: "xyz",
          title: "Love Acme's new dashboard",
          subreddit: "ProductManagement",
          score: 8,
          num_comments: 3,
          permalink: "/r/ProductManagement/comments/xyz/",
          created_utc: 1714300000,
          selftext: "",
        },
      },
      { kind: "t3", data: { subreddit: "x", score: 1 } }, // no title/id → dropped
    ],
  },
};

test("redditSearchUrl quotes the term and is read-only JSON", () => {
  expect(redditSearchUrl("acme")).toBe(
    "https://www.reddit.com/search.json?q=%22acme%22&sort=relevance&t=year&limit=25",
  );
});

test("parseRedditSearch maps mentions and drops malformed entries", () => {
  const mentions = parseRedditSearch(LISTING);
  expect(mentions).toHaveLength(2);
  expect(mentions[0]).toMatchObject({
    id: "abc",
    title: "Acme is overpriced for what it does",
    subreddit: "SaaS",
    score: 42,
    numComments: 17,
  });
});

test("parseRedditSearch tolerates non-listing input", () => {
  expect(parseRedditSearch(null)).toEqual([]);
  expect(parseRedditSearch({ foo: 1 })).toEqual([]);
});

test("buildRedditDoc is deterministic (sorted by id) and embeds an island", () => {
  const m = parseRedditSearch(LISTING);
  const a = buildRedditDoc("acme", m);
  const b = buildRedditDoc("acme", [...m].reverse());
  expect(a.html).toBe(b.html); // order-independent → stable content hash
  expect(a.text).toContain("Acme is overpriced");
  expect(a.html).toContain("outrival-reddit-mentions");
});
