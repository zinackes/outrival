import { extractBrand } from "@outrival/shared";
import type { ScrapeOptions, ScrapeOutcome } from "../types";
import { redditSearchUrl, parseRedditSearch, buildRedditDoc } from "./reddit";

/**
 * Reddit mention scraper (patch-32). Derives the competitor brand from its URL and
 * pulls recent mentions from Reddit's public search JSON (no auth, no browser).
 * Synthesises a deterministic snapshot consumed by the generic diff (new mentions)
 * and by extract-reviews (sentiment + complaint themes). Best-effort: Reddit may
 * rate-limit a datacenter IP — a failure throws so Trigger retries, never a fake
 * empty snapshot.
 */
export async function scrape(
  _competitorId: string,
  url: string,
  _options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const brand = extractBrand(url);
  if (!brand) throw new Error("reddit: no brand derivable from competitor URL");

  const searchUrl = redditSearchUrl(brand);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  let json: unknown;
  try {
    const res = await fetch(searchUrl, {
      signal: ctrl.signal,
      headers: {
        // Reddit rejects generic UAs; a descriptive one is required for the API.
        "user-agent": "OutrivalBot/1.0 (competitive monitoring; +https://outrival.io)",
        accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`reddit search HTTP ${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const mentions = parseRedditSearch(json);
  const { html, text } = buildRedditDoc(brand, mentions);
  return {
    html,
    text,
    screenshotBuffer: Buffer.alloc(0),
    metadata: { url: searchUrl, scrapedWith: "reddit-api", source: "reddit", query: brand, mentions: mentions.length },
    statusCode: 200,
    level: 0,
    attempts: 1,
  };
}
