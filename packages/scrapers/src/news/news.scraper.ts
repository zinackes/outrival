import { extractBrand } from "@outrival/shared";
import type { ScrapeOptions, ScrapeOutcome } from "../types";
import { parseFeed } from "../feeds/rss";
import { googleNewsRssUrl, filterNewsItems, buildNewsDoc } from "./news";

/** Recency window for company news (matches the RSS `when:` bound). */
const WINDOW_DAYS = 30;

/**
 * News / funding scraper. Derives the competitor brand from its URL and pulls
 * recent company-level events (funding, M&A, leadership, press) from Google
 * News' public RSS — no auth, no browser. Synthesises a deterministic snapshot
 * the generic diff turns into "new event" signals (classified funding/product/
 * hiring). Best-effort: a failure throws so Trigger retries, never a fake empty
 * snapshot.
 */
export async function scrape(
  _competitorId: string,
  url: string,
  _options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const brand = extractBrand(url);
  if (!brand) throw new Error("news: no brand derivable from competitor URL");

  const feedUrl = googleNewsRssUrl(brand, WINDOW_DAYS);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  let xml: string;
  try {
    const res = await fetch(feedUrl, {
      signal: ctrl.signal,
      headers: {
        "user-agent": "OutrivalBot/1.0 (competitive monitoring; +https://outrival.io)",
        accept: "application/rss+xml, application/xml, text/xml",
      },
    });
    if (!res.ok) throw new Error(`google news HTTP ${res.status}`);
    xml = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const items = filterNewsItems(parseFeed(xml), brand, { withinDays: WINDOW_DAYS });
  const { html, text } = buildNewsDoc(brand, items);
  return {
    html,
    text,
    screenshotBuffer: Buffer.alloc(0),
    metadata: {
      url: feedUrl,
      scrapedWith: "google-news-rss",
      source: "news",
      query: brand,
      items: items.length,
    },
    statusCode: 200,
    level: 0,
    attempts: 1,
  };
}
