import { test, expect } from "bun:test";
import { parseFeed, discoverFeedUrl } from "./rss";

test("parses an RSS 2.0 changelog feed", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
    <title>Acme Changelog</title>
    <item>
      <title>Shipped dark mode</title>
      <link>https://acme.com/changelog/dark-mode</link>
      <guid>chg-1</guid>
      <pubDate>Wed, 01 May 2024 10:00:00 GMT</pubDate>
      <description><![CDATA[You can now toggle dark mode.]]></description>
    </item>
    <item>
      <title>API v2</title>
      <link>https://acme.com/changelog/api-v2</link>
      <pubDate>Tue, 30 Apr 2024 09:00:00 GMT</pubDate>
    </item>
  </channel></rss>`;
  const items = parseFeed(xml);
  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({
    title: "Shipped dark mode",
    link: "https://acme.com/changelog/dark-mode",
    id: "chg-1",
    summary: "You can now toggle dark mode.",
  });
  expect(items[0]?.publishedAt).toBe("2024-05-01T10:00:00.000Z");
});

test("parses an Atom feed (link as href attribute)", () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <title>Acme</title>
    <entry>
      <title>Launched billing</title>
      <id>tag:acme,2024:1</id>
      <link rel="alternate" href="https://acme.com/posts/billing"/>
      <published>2024-04-15T08:00:00Z</published>
      <summary>New billing portal.</summary>
    </entry>
  </feed>`;
  const items = parseFeed(xml);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    title: "Launched billing",
    link: "https://acme.com/posts/billing",
    id: "tag:acme,2024:1",
    publishedAt: "2024-04-15T08:00:00.000Z",
  });
});

test("non-feed payload yields no items", () => {
  expect(parseFeed("<html><body>not a feed</body></html>")).toEqual([]);
});

test("entities in titles are decoded", () => {
  const xml = `<rss><channel><item><title>Tom &amp; Jerry &lt;v2&gt;</title><link>x</link></item></channel></rss>`;
  expect(parseFeed(xml)[0]?.title).toBe("Tom & Jerry <v2>");
});

test("discoverFeedUrl finds an advertised RSS link and resolves it absolute", () => {
  const html = `<html><head>
    <link rel="alternate" type="application/rss+xml" href="/changelog/feed.xml" title="Changelog">
  </head></html>`;
  expect(discoverFeedUrl(html, "https://acme.com/changelog")).toBe(
    "https://acme.com/changelog/feed.xml",
  );
});

test("discoverFeedUrl returns null when no feed is advertised", () => {
  expect(discoverFeedUrl("<html><head></head></html>", "https://acme.com")).toBeNull();
});
