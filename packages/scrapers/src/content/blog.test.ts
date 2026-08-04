import { test, expect } from "bun:test";
import { parseFeed } from "../feeds/rss";
import { extractContent } from "../lib/extract-content";
import { buildBlogIsland, parseBlogItems, blogIslandShape } from "./parse";
import { extractPostLinks, canonicalizeUrl } from "./blog-links";
import { extractArticleText } from "./article-text";
import { applyBlogGuards } from "./blog-enrich";
import { resolveSelfMatch, namesBrand } from "./named-you";
import { fetchPostTexts, MAX_POST_BYTES, POST_FETCH_CAP } from "./fetch";
import { planBlogRun, BASELINE_ITEMS } from "./blog-run";
import type { ContentItemInput } from "./types";

// ── Feed-first ingestion, writer → reader round trip ────────────────────────
// The island is built by the SAME function the blog scraper calls, so a renamed
// field fails here rather than going quiet in production.

function feedSnapshot(xml: string, feedUrl = "https://acme.com/blog/feed.xml"): string {
  const items = parseFeed(xml);
  return `<!doctype html><html><body><section><h2>Blog</h2></section>${buildBlogIsland(
    { feedUrl, listingUrl: "https://acme.com/blog" },
    items.map((it) => ({
      id: it.id,
      title: it.title,
      link: it.link,
      publishedAt: it.publishedAt,
      summary: it.summary,
    })),
  )}</body></html>`;
}

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
  <title>Acme Blog</title>
  <item>
    <title>Why we rebuilt our sync engine</title>
    <link>https://acme.com/blog/sync-engine</link>
    <guid>post-1</guid>
    <pubDate>Wed, 01 May 2024 10:00:00 GMT</pubDate>
    <description><![CDATA[A teardown of the old pipeline.]]></description>
  </item>
  <item>
    <title>Acme vs the incumbents</title>
    <link>https://acme.com/blog/comparison</link>
    <guid>post-2</guid>
    <pubDate>Thu, 02 May 2024 10:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
  <title>Acme Blog</title>
  <entry>
    <title>Shipping weekly</title>
    <link href="https://acme.com/blog/shipping-weekly"/>
    <id>tag:acme.com,2024:post-9</id>
    <published>2024-06-11T08:00:00Z</published>
    <summary>How our release train works.</summary>
  </entry>
</feed>`;

test("ingests an RSS 2.0 blog feed, keyed on the publisher's guid", () => {
  const items = parseBlogItems(feedSnapshot(RSS));
  expect(items).toHaveLength(2);
  expect(items[0]!.externalId).toBe("post-1");
  expect(items[0]!.title).toBe("Why we rebuilt our sync engine");
  expect(items[0]!.url).toBe("https://acme.com/blog/sync-engine");
  expect(items[0]!.publishedAt).toBe("2024-05-01T10:00:00.000Z");
});

test("ingests an Atom blog feed", () => {
  const items = parseBlogItems(feedSnapshot(ATOM));
  expect(items).toHaveLength(1);
  expect(items[0]!.externalId).toBe("tag:acme.com,2024:post-9");
  expect(items[0]!.url).toBe("https://acme.com/blog/shipping-weekly");
});

test("the island is invisible to change detection", () => {
  const bare = `<!doctype html><html><body><h1>Blog</h1><p>Two posts this week.</p></body></html>`;
  const withIsland = `${bare}${buildBlogIsland({ feedUrl: null, listingUrl: "https://acme.com/blog" }, [
    { id: "https://acme.com/blog/a", title: "A post title here", link: "https://acme.com/blog/a", publishedAt: null },
  ])}`;
  // extractContent strips <script>, and the content hash is taken over its output:
  // attaching the island can never fake a change on a blog that has no feed.
  expect(extractContent(withIsland, "blog")).toBe(extractContent(bare, "blog"));
});

test("the capture reports its own shape, so the feed-first switch can be detected", () => {
  expect(blogIslandShape(feedSnapshot(RSS))).toBe("feed");
  expect(
    blogIslandShape(
      buildBlogIsland({ feedUrl: null, listingUrl: "https://acme.com/blog" }, [
        { id: "https://acme.com/blog/a", title: "A post title here", link: "https://acme.com/blog/a", publishedAt: null },
      ]),
    ),
  ).toBe("listing");
  // A capture taken before P2 carries no island at all — the case the re-baseline
  // exists for, and the one that would otherwise diff a feed against rendered HTML.
  expect(blogIslandShape("<html><body>old capture</body></html>")).toBeNull();
});

// ── Feedless blogs: reading the posts off the index ─────────────────────────

const LISTING = `<!doctype html><html><body>
  <nav><a href="/pricing">Pricing</a><a href="/blog">Blog</a></nav>
  <main>
    <article>
      <h2><a href="/blog/why-we-rebuilt-sync?utm_source=nav">Why we rebuilt our sync engine</a></h2>
      <time datetime="2024-05-01">May 1, 2024</time>
    </article>
    <article>
      <h2><a href="https://acme.com/blog/shipping-weekly">How we ship weekly</a></h2>
    </article>
    <a href="/blog/category/engineering">Engineering posts</a>
    <a href="/blog/page/2">Next page</a>
    <a href="https://twitter.com/acme">Follow us on Twitter</a>
    <a href="/blog/feed.xml">RSS feed here</a>
    <a href="/blog/x">Read</a>
  </main>
</body></html>`;

test("reads posts off a listing and skips everything that is not one", () => {
  const links = extractPostLinks(LISTING, "https://acme.com/blog");
  const urls = links.map((l) => l.url);
  expect(urls).toEqual([
    "https://acme.com/blog/why-we-rebuilt-sync",
    "https://acme.com/blog/shipping-weekly",
  ]);
  // The tracking query is stripped, so the same post linked twice is one row.
  expect(links[0]!.publishedAt).toBe(new Date("2024-05-01").toISOString());
});

test("a 'recent posts' sidebar does not strip a post of its date", () => {
  // Docusaurus (and most blog themes) render an undated "Recent posts" nav BEFORE
  // the listing. Its anchors used to win the dedup, so the newest posts landed
  // with no publishedAt and were then dated from the day we scraped them.
  const html = `<!doctype html><html><body>
    <aside><nav aria-label="Blog recent posts navigation"><ul>
      <li><a href="/blog/release/4.0">Release: Yarn 4.0</a></li>
    </ul></nav></aside>
    <main><article>
      <h2><a href="/blog/release/4.0">Release: Yarn 4.0</a></h2>
      <time datetime="2023-10-23T00:00:00.000Z">October 23, 2023</time>
    </article></main>
  </body></html>`;

  const links = extractPostLinks(html, "https://yarnpkg.com/blog");
  expect(links).toHaveLength(1);
  expect(links[0]!.publishedAt).toBe("2023-10-23T00:00:00.000Z");
});

test("canonicalisation drops query, fragment and trailing slash", () => {
  expect(canonicalizeUrl("https://Acme.com/blog/post/?utm=x#top")).toBe(
    "https://acme.com/blog/post",
  );
  expect(canonicalizeUrl("mailto:hi@acme.com")).toBeNull();
});

test("a listing whose posts sit outside the index path still resolves", () => {
  const html = `<html><body><article><h3><a href="/news/series-b-funding-round">Our Series B</a></h3></article></body></html>`;
  expect(extractPostLinks(html, "https://acme.com/resources")).toHaveLength(1);
});

// ── Article extraction ──────────────────────────────────────────────────────

test("the article wins over the page's sidebars", () => {
  const html = `<html><body>
    <nav>Home Pricing Contact</nav>
    <article><h1>Why we rebuilt sync</h1><p>${"The old pipeline batched every write. ".repeat(20)}</p></article>
    <aside><h2>Related</h2><a href="/blog/other">Competitor X teardown</a></aside>
    <footer>© 2026 Acme</footer>
  </body></html>`;
  const text = extractArticleText(html);
  expect(text).toContain("The old pipeline batched every write.");
  // A competitor named in the related-posts rail is not named in the post.
  expect(text).not.toContain("Competitor X teardown");
});

// ── Enrichment guards: the model proposes, code decides ─────────────────────

const POST_TEXT =
  "We compared our sync engine against Fivetran on a 40-table workload. " +
  "Fivetran charges per monthly active row, which surprised the team.";

test("a mention survives only when the post writes the name AND the quote", () => {
  const kept = applyBlogGuards(POST_TEXT, {
    itemType: "thought_leadership",
    topics: ["Data Pipelines", "data pipelines", "  "],
    products: ["Sync Engine"],
    personas: ["data engineers"],
    competitorsNamed: [
      // Named and quoted verbatim → kept.
      { name: "Fivetran", snippet: "Fivetran charges per monthly active row" },
      // Never named in the post → dropped, whatever the model inferred.
      { name: "Airbyte", snippet: "Fivetran charges per monthly active row" },
      // Named, but the sentence is not in the text → dropped.
      { name: "Fivetran", snippet: "Fivetran is the most expensive option on the market" },
    ],
    summary: "  A comparison of sync approaches.  ",
  });

  expect(kept.mentions).toHaveLength(1);
  expect(kept.mentions[0]!.name).toBe("Fivetran");
  expect(kept.itemType).toBe("thought_leadership");
  // Topics are lowercased and deduped; the blank one never becomes a tag.
  expect(kept.topics).toEqual(["data pipelines"]);
  expect(kept.summary).toBe("A comparison of sync approaches.");
});

test("an invented item type becomes null rather than a made-up label", () => {
  expect(applyBlogGuards(POST_TEXT, { itemType: "hot_take" }).itemType).toBeNull();
});

// ── competitor_named_you: the critical one ──────────────────────────────────

test("the domain is enough on its own", () => {
  const text = "Teams switching from outrival.io tell us the same thing.";
  expect(
    resolveSelfMatch({
      mention: "Outrival",
      postText: text,
      self: { brands: ["Outrival"], domains: ["outrival.io"] },
    }),
  ).toBe("domain");
});

test("a distinctive brand matches at word boundaries", () => {
  expect(
    resolveSelfMatch({
      mention: "Outrival",
      postText: "Unlike Outrival, we do not charge per seat.",
      self: { brands: ["Outrival"], domains: ["outrival.io"] },
    }),
  ).toBe("brand");
  // Inside another word it is not a mention.
  expect(namesBrand("Their outrivalling ambition shows.", "Outrival")).toBe(false);
});

test("a brand that is an ordinary word needs the domain", () => {
  const self = { brands: ["Linear"], domains: ["linear.app"] };
  // "our roadmap is linear" is not a mention of Linear.
  expect(
    resolveSelfMatch({
      mention: "Linear",
      postText: "Our planning process is linear, not iterative.",
      self,
    }),
  ).toBeNull();
  // With the domain in the post, it is.
  expect(
    resolveSelfMatch({
      mention: "Linear",
      postText: "We moved off linear.app last quarter.",
      self,
    }),
  ).toBe("domain");
});

// ── The baseline: the first capture is written, never read ─────────────────

function item(i: number, publishedAt: string | null): ContentItemInput {
  return {
    externalId: `post-${i}`,
    title: `Post number ${i}`,
    url: `https://acme.com/blog/${i}`,
    publishedAt,
    body: null,
    status: null,
    itemType: null,
  };
}

test("a blog we have never seen is baselined at its newest 30, and read not at all", () => {
  const archive = Array.from({ length: 80 }, (_, i) =>
    item(i, `2024-${String((i % 12) + 1).padStart(2, "0")}-01T00:00:00.000Z`),
  );
  const plan = planBlogRun({ heldRows: 0, items: archive });

  expect(plan.mode).toBe("baseline");
  if (plan.mode !== "baseline") throw new Error("unreachable");
  expect(plan.seed).toHaveLength(BASELINE_ITEMS);
  // Newest first: a two-year archive never pushes the recent posts out of the seed.
  expect(plan.seed[0]!.publishedAt).toBe("2024-12-01T00:00:00.000Z");
  // And there is no read plan at all — the baseline mode carries no items to fetch.
  expect("items" in plan).toBe(false);
});

test("an undated listing keeps its own order in the baseline", () => {
  const plan = planBlogRun({ heldRows: 0, items: [item(1, null), item(2, null)] });
  if (plan.mode !== "baseline") throw new Error("unreachable");
  expect(plan.seed.map((s) => s.externalId)).toEqual(["post-1", "post-2"]);
});

test("once we hold rows, every capture is a read", () => {
  const plan = planBlogRun({ heldRows: 30, items: [item(99, null)] });
  expect(plan.mode).toBe("read");
});

// ── Fetch: the caps are the contract ────────────────────────────────────────

const article = (body: string) => `<html><body><article><p>${body}</p></article></body></html>`;

function posts(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, url: `https://acme.com/blog/${i}` }));
}

test("at most POST_FETCH_CAP posts are requested in one run", async () => {
  const asked: string[] = [];
  const { fetched } = await fetchPostTexts(posts(50), {
    fetchPost: async (url) => {
      asked.push(url);
      return { ok: true, html: article("A readable post body. ".repeat(30)), bytes: 900 };
    },
  });
  expect(asked).toHaveLength(POST_FETCH_CAP);
  expect(fetched).toHaveLength(POST_FETCH_CAP);
});

test("the cap counts attempts, not successes", async () => {
  let calls = 0;
  const { fetched, failed } = await fetchPostTexts(posts(50), {
    fetchPost: async () => {
      calls++;
      return { ok: false, reason: "http_403" };
    },
  });
  expect(calls).toBe(POST_FETCH_CAP);
  expect(fetched).toHaveLength(0);
  expect(failed).toHaveLength(POST_FETCH_CAP);
});

test("an oversized post is skipped, never read", async () => {
  const { fetched, failed } = await fetchPostTexts(posts(1), {
    fetchPost: async () => ({
      ok: true,
      html: article("x".repeat(600 * 1024)),
      bytes: 600 * 1024,
    }),
  });
  expect(fetched).toHaveLength(0);
  expect(failed[0]!.reason).toBe("too_large");
  expect(600 * 1024).toBeGreaterThan(MAX_POST_BYTES);
});

test("a JS-only shell counts as unread rather than as an empty post", async () => {
  const { fetched, failed } = await fetchPostTexts(posts(1), {
    fetchPost: async () => ({ ok: true, html: "<html><body></body></html>", bytes: 30 }),
  });
  expect(fetched).toHaveLength(0);
  expect(failed[0]!.reason).toBe("empty_article");
});
