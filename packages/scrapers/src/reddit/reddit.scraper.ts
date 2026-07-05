import { extractBrand } from "@outrival/shared";
import type { ScrapeOptions, ScrapeOutcome } from "../types";
import { redditSearchUrl, parseRedditSearch, buildRedditDoc } from "./reddit";
import { getRedditToken, invalidateRedditToken, REDDIT_USER_AGENT } from "./reddit-auth";

/**
 * Reddit mention scraper (patch-32). Derives the competitor brand from its URL and
 * pulls recent mentions from Reddit's OAuth search API (oauth.reddit.com, app-only
 * bearer token — cf. reddit-auth.ts). No browser, no proxy: authenticated requests
 * are accepted from the server IP and stay within the free tier (100 QPM), unlike the
 * old unauthenticated www.reddit.com/*.json path which Reddit now 403s from datacenter
 * IPs. Synthesises a deterministic snapshot consumed by the generic diff (new mentions)
 * and by extract-reviews (sentiment + complaint themes). Best-effort: a failure throws
 * so Trigger retries, never a fake empty snapshot.
 */
async function searchOnce(
  searchUrl: string,
  token: string,
): Promise<{ status: number; json: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(searchUrl, {
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": REDDIT_USER_AGENT,
        accept: "application/json",
      },
    });
    return { status: res.status, json: res.ok ? await res.json() : null };
  } finally {
    clearTimeout(timer);
  }
}

export async function scrape(
  _competitorId: string,
  url: string,
  _options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const brand = extractBrand(url);
  if (!brand) throw new Error("reddit: no brand derivable from competitor URL");

  const searchUrl = redditSearchUrl(brand);

  let token = await getRedditToken();
  let { status, json } = await searchOnce(searchUrl, token);
  // A stale/expired token → refresh once and retry before giving up.
  if (status === 401) {
    invalidateRedditToken();
    token = await getRedditToken(true);
    ({ status, json } = await searchOnce(searchUrl, token));
  }
  if (status !== 200) throw new Error(`reddit search HTTP ${status}`);

  const mentions = parseRedditSearch(json);
  const { html, text } = buildRedditDoc(brand, mentions);
  return {
    html,
    text,
    screenshotBuffer: Buffer.alloc(0),
    metadata: {
      url: searchUrl,
      scrapedWith: "reddit-oauth-api",
      source: "reddit",
      query: brand,
      mentions: mentions.length,
    },
    statusCode: 200,
    level: 0,
    attempts: 1,
  };
}
