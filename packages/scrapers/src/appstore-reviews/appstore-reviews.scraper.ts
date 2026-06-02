import {
  parseAppStoreUrl,
  appStoreReviewsRssUrl,
  type AppStoreReview,
  type AppStoreSnapshot,
} from "@outrival/shared";
import type { ScrapeOutcome } from "../types";

const MAX_PAGES = 3;

interface RssEntry {
  "im:rating"?: { label?: string };
  title?: { label?: string };
  content?: { label?: string };
  author?: { name?: { label?: string } };
  updated?: { label?: string };
}

/**
 * Scrape App Store customer reviews via Apple's official RSS JSON feed.
 * No browser, no proxy — structured data straight from itunes.apple.com. The
 * stored snapshot is our normalized shape (not Apple's verbose feed) and carries
 * no timestamp, so the content hash is stable when reviews are unchanged.
 */
export async function scrape(_competitorId: string, url: string): Promise<ScrapeOutcome> {
  const ref = parseAppStoreUrl(url);
  if (!ref) throw new Error(`Not a valid App Store URL: ${url}`);

  const reviews: AppStoreReview[] = [];
  let lastStatus = 200;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(appStoreReviewsRssUrl(ref, page), {
      headers: { accept: "application/json" },
    });
    lastStatus = res.status;
    if (!res.ok) break;

    const json = (await res.json()) as { feed?: { entry?: RssEntry | RssEntry[] } };
    const raw = json.feed?.entry;
    const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
    // Apple's first entry is app metadata (no im:rating) — filtered out here.
    const pageReviews = entries
      .filter((e) => e["im:rating"]?.label)
      .map<AppStoreReview>((e) => ({
        rating: Number(e["im:rating"]?.label ?? 0) || 0,
        title: e.title?.label ?? "",
        content: e.content?.label ?? "",
        author: e.author?.name?.label ?? "anonymous",
        updated: e.updated?.label ?? "",
      }));
    if (pageReviews.length === 0) break;
    reviews.push(...pageReviews);
  }

  const snapshot: AppStoreSnapshot = {
    source: "appstore",
    appId: ref.appId,
    country: ref.country,
    reviews,
  };
  const html = JSON.stringify(snapshot);

  return {
    html,
    text: html,
    screenshotBuffer: Buffer.alloc(0),
    metadata: {
      source: "appstore",
      appId: ref.appId,
      country: ref.country,
      reviewCount: reviews.length,
    },
    statusCode: lastStatus,
    level: 0, // RSS JSON, no browser/proxy
    attempts: 1,
  };
}
