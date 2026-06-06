import { scrapeStatic, scrapeFirstSuccess } from "../lib/crawler";
import type { ScrapeOutcome, ScrapeOptions } from "../types";
import { discoverFeedUrl, parseFeed, type FeedItem } from "../feeds/rss";

/**
 * Changelog scraper (patch-32, product-velocity signal). Feed-first: when the page
 * advertises (or conventionally exposes) a native RSS/Atom feed, we parse the feed
 * — exact, dated entries — and synthesise a deterministic snapshot so the generic
 * diff pipeline detects *new release entries* precisely, rather than diffing noisy
 * rendered HTML. No feed → fall back to plain static change-detection (today's path).
 */

const CHANGELOG_PATHS = ["/changelog", "/releases", "/release-notes", "/whats-new", "/updates"];
const CHANGELOG_KEYWORDS = ["changelog", "releases", "release-notes", "whats-new", "updates"];
// Probed when the page advertises no <link rel="alternate"> feed.
const FEED_PATHS = ["/changelog.rss", "/changelog/feed", "/changelog/feed.xml", "/feed", "/rss", "/atom.xml", "/feed.xml"];

const MARKER = "outrival-changelog-feed";

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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(feedUrl, {
      signal: ctrl.signal,
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
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a stable snapshot from feed entries: sorted by id so an unchanged feed
 * yields a constant content hash (no phantom change), with a JSON island for any
 * downstream structured use. Page validators are dropped so a page-level 304 can
 * never mask new feed entries.
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
  const json = JSON.stringify({ feedUrl, items: sorted }).replace(/</g, "\\u003c");
  const html =
    `<!doctype html><html><body><section data-outrival-changelog><h2>Changelog</h2><ul>${lis}</ul></section>` +
    `<script type="application/json" id="${MARKER}">${json}</script></body></html>`;
  const text = sorted
    .map((it) => [it.publishedAt?.slice(0, 10), it.title].filter(Boolean).join(" "))
    .join("\n");
  return {
    ...page,
    html,
    text,
    metadata: { ...page.metadata, changelogFeed: feedUrl, feedEntries: sorted.length },
    etag: undefined,
    lastModified: undefined,
  };
}

export async function scrape(
  _competitorId: string,
  url: string,
  _options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const lowered = url.toLowerCase();
  const page = CHANGELOG_KEYWORDS.some((k) => lowered.includes(k))
    ? await scrapeStatic(url)
    : await scrapeFirstSuccess(url, CHANGELOG_PATHS, scrapeStatic);

  const advertised = discoverFeedUrl(page.html, url);
  const candidates = advertised
    ? [advertised]
    : FEED_PATHS.map((p) => safeUrl(p, url)).filter((u): u is string => Boolean(u));

  for (const feedUrl of candidates) {
    const items = await fetchFeed(feedUrl);
    if (items) return feedOutcome(page, feedUrl, items);
  }
  return page;
}
