import { safeFetch } from "../lib/guarded-fetch";
import type { ScrapeOptions, ScrapeOutcome } from "../types";
import {
  findYouTubeChannelUrl,
  channelIdFromUrl,
  extractChannelId,
  isYouTubeUrl,
  channelFeedUrl,
  parseChannelFeed,
  buildYouTubeDoc,
  type Video,
} from "./youtube";

/**
 * YouTube channel scraper (content-velocity signal). Resolves the competitor's
 * channel from a link on its homepage, pulls the OFFICIAL videos RSS feed (no
 * auth, no browser), and synthesises a deterministic snapshot the generic diff
 * turns into "new video" signals (classify tags content). Self-contained like
 * news/subdomains: it fetches its own targets (the scrapers package is DB-free),
 * so "the homepage YouTube link" is (re)discovered per run rather than read back
 * from a stored snapshot. Transcripts/captions are deliberately never fetched
 * (fragile, ToS grey zone). Fail-loud: no channel / unreachable feed / empty feed
 * throws so Trigger retries, never a fake empty snapshot.
 */

const FETCH_TIMEOUT_MS = 10_000;
const UA = "Mozilla/5.0 (compatible; OutrivalBot/1.0; +https://outrival.io)";

export interface CollectDeps {
  /** Injected for tests; defaults to the SSRF-safe fetch. Null = unreachable. */
  fetchText?: (url: string) => Promise<string | null>;
}

async function defaultFetchText(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml,application/rss+xml,*/*",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Resolve the competitor's channel id from its homepage: find the YouTube link,
 * take an inline `/channel/UC…` id directly (zero extra fetch), else fetch the
 * channel page and pull the id out. Null when no channel is linked / resolvable.
 */
export async function resolveChannelId(
  homepageUrl: string,
  deps: CollectDeps = {},
): Promise<string | null> {
  const fetchText = deps.fetchText ?? defaultFetchText;
  // A pinned channel URL is the user overruling "no channel linked from their
  // site", so it IS the answer — looking for a link to the channel inside the
  // channel's own page would resolve by accident at best.
  if (isYouTubeUrl(homepageUrl)) {
    const inlineId = channelIdFromUrl(homepageUrl);
    if (inlineId) return inlineId;
    const pinnedPage = await fetchText(homepageUrl);
    return pinnedPage ? extractChannelId(pinnedPage) : null;
  }
  const homepage = await fetchText(homepageUrl);
  if (!homepage) return null;
  const channelUrl = findYouTubeChannelUrl(homepage, homepageUrl);
  if (!channelUrl) return null;
  const inline = channelIdFromUrl(channelUrl);
  if (inline) return inline;
  const channelPage = await fetchText(channelUrl);
  return channelPage ? extractChannelId(channelPage) : null;
}

/**
 * Core pipeline (deps injectable for tests): homepage → channel id → official RSS
 * feed → parsed, sorted videos. Throws (like sitemap's no_sitemap_found) rather
 * than emit an empty snapshot a later populated run would read as "every video
 * added".
 */
export async function collectVideos(
  homepageUrl: string,
  deps: CollectDeps = {},
): Promise<{ channelId: string; videos: Video[] }> {
  const channelId = await resolveChannelId(homepageUrl, deps);
  if (!channelId) throw new Error("youtube: no_channel");
  const fetchText = deps.fetchText ?? defaultFetchText;
  const xml = await fetchText(channelFeedUrl(channelId));
  if (!xml) throw new Error("youtube: feed_unreachable");
  const videos = parseChannelFeed(xml);
  if (videos.length === 0) throw new Error("youtube: empty_feed");
  return { channelId, videos };
}

export async function scrape(
  _competitorId: string,
  url: string,
  _options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const { channelId, videos } = await collectVideos(url);
  const { html, text } = buildYouTubeDoc(channelId, videos);
  return {
    html,
    text,
    screenshotBuffer: Buffer.alloc(0),
    metadata: {
      url: channelFeedUrl(channelId),
      scrapedWith: "youtube-rss",
      source: "youtube",
      channelId,
      videos: videos.length,
    },
    statusCode: 200,
    level: 0,
    attempts: 1,
  };
}
