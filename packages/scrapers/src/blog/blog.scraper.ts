import { scrapeStatic, scrapeFirstSuccess } from "../lib/crawler";
import { safeFetch } from "../lib/guarded-fetch";
import type { ScrapeOutcome, ScrapeOptions } from "../types";
import { discoverFeedUrl, parseFeed, type FeedItem } from "../feeds/rss";
import { buildBlogIsland, extractPostLinks, canonicalizeUrl } from "../content";

/**
 * Blog scraper. Feed-first (Content Intelligence v2 P2), the same shape the
 * changelog has had since patch-32 — `feeds/rss.ts` said "changelog **or blog**"
 * in its own opening comment and the blog was the half that never used it.
 *
 * A feed gives exact, dated, id-bearing entries, so the diff detects a NEW POST
 * rather than a redesigned card grid, and the ingestion downstream re-reads what
 * this scraper already knew instead of parsing prose back out of a listing.
 *
 * No feed → the rendered index stays the diff body, unchanged, and the island only
 * carries the post links read off it. That is the floor: a blog without a feed
 * behaves exactly as it did before this file changed, because `extractContent`
 * strips `<script>` before hashing and the island is a `<script>`.
 */

const BLOG_PATHS = ["/blog", "/changelog", "/news", "/updates", "/posts"];

const BLOG_KEYWORDS = ["blog", "changelog", "news"];

// Probed when the page advertises no <link rel="alternate"> feed. Blog-shaped
// paths first: on a site whose /blog has no feed but whose root does, the root
// feed is usually the changelog, and filing its entries as blog posts would put
// release notes in the editorial timeline.
const FEED_PATHS = [
  "/blog/feed",
  "/blog/rss",
  "/blog/feed.xml",
  "/blog/rss.xml",
  "/blog/atom.xml",
  "/feed",
  "/rss",
  "/rss.xml",
  "/feed.xml",
  "/atom.xml",
  "/index.xml",
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeUrl(path: string, base: string): string | null {
  try {
    return new URL(path, base).toString();
  } catch {
    return null;
  }
}

async function fetchFeed(feedUrl: string): Promise<FeedItem[] | null> {
  try {
    const res = await safeFetch(feedUrl, {
      timeoutMs: 8000,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; OutrivalBot/1.0; +https://outrival.io)",
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) return null;
    const items = parseFeed(await res.text());
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

/**
 * Build a stable snapshot from feed entries: sorted by id so an unchanged feed
 * yields a constant content hash, with the JSON island the ingestion reads. Page
 * validators are dropped so a page-level 304 can never mask new entries.
 */
function feedOutcome(page: ScrapeOutcome, feedUrl: string, items: FeedItem[]): ScrapeOutcome {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const lis = sorted
    .map((it) => {
      const meta = [it.publishedAt?.slice(0, 10), it.link]
        .filter((x): x is string => Boolean(x))
        .map(escapeHtml)
        .join(" · ");
      return `<li>${escapeHtml(it.title)}${meta ? ` — ${meta}` : ""}</li>`;
    })
    .join("");
  const island = buildBlogIsland(
    { feedUrl, listingUrl: String(page.metadata?.url ?? feedUrl) },
    sorted.map((it) => ({
      id: it.id,
      title: it.title,
      // Canonical so the row's identity survives a listing that links the same
      // post with a tracking query, and so the fetch below hits one URL per post.
      link: it.link ? (canonicalizeUrl(it.link) ?? it.link) : null,
      publishedAt: it.publishedAt,
      summary: it.summary,
    })),
  );
  const html =
    `<!doctype html><html><body><section data-outrival-blog><h2>Blog</h2><ul>${lis}</ul></section>` +
    `${island}</body></html>`;
  const text = sorted
    .map((it) => [it.publishedAt?.slice(0, 10), it.title].filter(Boolean).join(" "))
    .join("\n");
  return {
    ...page,
    html,
    text,
    metadata: { ...page.metadata, blogFeed: feedUrl, feedEntries: sorted.length },
    etag: undefined,
    lastModified: undefined,
  };
}

/**
 * Attach the island to a rendered index page WITHOUT touching what gets diffed.
 *
 * The body is returned as captured and only a `<script>` is appended, which
 * `extractContent` removes before hashing — so a blog with no feed produces the
 * same content hash, the same diff and the same signals as it did before P2.
 */
function listingOutcome(page: ScrapeOutcome, listingUrl: string): ScrapeOutcome {
  const links = extractPostLinks(page.html, listingUrl);
  if (links.length === 0) return page;
  const island = buildBlogIsland(
    { feedUrl: null, listingUrl },
    links.map((l) => ({ id: l.url, title: l.title, link: l.url, publishedAt: l.publishedAt })),
  );
  return {
    ...page,
    html: `${page.html}${island}`,
    metadata: { ...page.metadata, blogPostLinks: links.length },
  };
}

export async function scrape(
  _competitorId: string,
  url: string,
  _options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const lowered = url.toLowerCase();
  const page = BLOG_KEYWORDS.some((k) => lowered.includes(k))
    ? await scrapeStatic(url)
    : await scrapeFirstSuccess(url, BLOG_PATHS, scrapeStatic);

  // The URL the capture actually landed on — the base every link is resolved
  // against, and the path the "is this deeper than the index" test measures.
  const listingUrl = String(page.metadata?.url ?? url);

  const advertised = discoverFeedUrl(page.html, listingUrl);
  const candidates = advertised
    ? [advertised]
    : FEED_PATHS.map((p) => safeUrl(p, listingUrl)).filter((u): u is string => Boolean(u));

  for (const feedUrl of candidates) {
    const items = await fetchFeed(feedUrl);
    if (items) return feedOutcome(page, feedUrl, items);
  }
  return listingOutcome(page, listingUrl);
}
