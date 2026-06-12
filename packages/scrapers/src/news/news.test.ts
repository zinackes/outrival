import { test, expect } from "bun:test";
import { googleNewsRssUrl, filterNewsItems, buildNewsDoc, parseNewsFeed } from "./news";

// A trimmed Google News RSS payload: two Acme items (one recent, one old) + one
// unrelated item (homonym noise the brand filter must drop).
const FEED = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Acme raises $120M Series C to expand in Europe - TechCrunch</title>
    <link>https://news.google.com/rss/articles/aaa</link>
    <guid isPermaLink="false">guid-aaa</guid>
    <pubDate>Wed, 10 Jun 2026 09:00:00 GMT</pubDate>
    <description>Acme announced a new funding round.</description>
  </item>
  <item>
    <title>Acme names new CFO ahead of IPO - Reuters</title>
    <link>https://news.google.com/rss/articles/bbb</link>
    <guid isPermaLink="false">guid-bbb</guid>
    <pubDate>Mon, 02 Feb 2026 09:00:00 GMT</pubDate>
    <description>Leadership change at Acme.</description>
  </item>
  <item>
    <title>Wile E. Coyote orders another anvil - Looney Times</title>
    <link>https://news.google.com/rss/articles/ccc</link>
    <guid isPermaLink="false">guid-ccc</guid>
    <pubDate>Tue, 09 Jun 2026 09:00:00 GMT</pubDate>
    <description>Nothing to do with the company.</description>
  </item>
</channel></rss>`;

const NOW = new Date("2026-06-12T00:00:00Z").getTime();

test("googleNewsRssUrl quotes the brand and bounds the window", () => {
  expect(googleNewsRssUrl("acme", 30)).toBe(
    "https://news.google.com/rss/search?q=%22acme%22%20when%3A30d&hl=en-US&gl=US&ceid=US:en",
  );
});

test("parseNewsFeed keeps brand matches, splits the publisher, drops homonyms", () => {
  const items = parseNewsFeed(FEED, "Acme", { now: NOW, withinDays: 30 });
  // Old CFO item is outside the 30-day window; coyote item fails the brand filter.
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    id: "guid-aaa",
    title: "Acme raises $120M Series C to expand in Europe",
    source: "TechCrunch",
  });
});

test("filterNewsItems honours a wider window and de-dups by id", () => {
  const items = parseNewsFeed(FEED, "Acme", { now: NOW, withinDays: 365 });
  expect(items).toHaveLength(2); // both Acme items, coyote still excluded
  // Most recent first.
  expect(items[0]?.id).toBe("guid-aaa");
  expect(items[1]?.id).toBe("guid-bbb");
});

test("buildNewsDoc is deterministic (sorted by id) and embeds an island", () => {
  const items = parseNewsFeed(FEED, "Acme", { now: NOW, withinDays: 365 });
  const a = buildNewsDoc("Acme", items);
  const b = buildNewsDoc("Acme", [...items].reverse());
  expect(a.html).toBe(b.html); // order-independent → stable content hash
  expect(a.text).toContain("Acme raises $120M Series C");
  expect(a.html).toContain("outrival-news-items");
});

test("parseNewsFeed tolerates non-feed input", () => {
  expect(parseNewsFeed("not xml", "Acme")).toEqual([]);
  expect(parseNewsFeed("", "Acme")).toEqual([]);
});
