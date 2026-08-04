import {
  parseShopifyAppUrl,
  shopifyReviewsUrl,
  type ShopifyReview,
  type ShopifyReviewsSnapshot,
} from "@outrival/shared";
import { scrapeStatic } from "../lib/crawler";
import { parseShopifyReviewsPage } from "./parse";
import type { ScrapeOptions, ScrapeOutcome } from "../types";

/** 10 reviews a page. Three pages is the recent window an inflection needs. */
const MAX_PAGES = 3;

/**
 * Scrape Shopify App Store merchant reviews.
 *
 * Verified live 2026-08-04 (curl): `apps.shopify.com/{handle}/reviews?sort_by=newest`
 * answers 200 with the reviews server-rendered (no JS, no anti-bot), 10 to a page,
 * each card carrying `data-review-content-id`, its star rating, the merchant's store
 * name, country and tenure, plus the listing's own JSON-LD AggregateRating.
 *
 * Unlike the App Store feed this is a WEB PAGE, so it goes through `scrapeStatic`
 * like every other L0 capture: robots.txt is consulted before the first request (and
 * apps.shopify.com declares no `User-agent: *` group, so we are allowed), the
 * per-domain gap is awaited between pages, and a refusal propagates as a refusal
 * rather than as an empty result. No exception to the collection doctrine is taken
 * here, which is precisely what separates this source from the retired aggregators.
 *
 * The SCORE + COUNT come from the listing-wide JSON-LD aggregate, never from the mean
 * of the captured window: `sort_by=newest` returns whoever wrote in last, which after
 * a bad release is not the rating the store displays (same reason the App Store
 * scraper reads Apple's Lookup aggregate instead of its RSS sample).
 *
 * The stored snapshot is our normalized shape, deduped by review id, sorted, and
 * carrying no timestamp, so the content hash is stable when nothing moved and the
 * generic diff maps +/- lines to added/removed reviews.
 *
 * Deliberately NOT in scrape-monitor's SIZE_VARIABLE_SOURCES: like App Store this is
 * a bounded rotating window, so a collapse to near-empty must be caught by the
 * anti-void guard rather than read as "every review removed".
 */
export async function scrape(
  _competitorId: string,
  url: string,
  _options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const ref = parseShopifyAppUrl(url);
  if (!ref) throw new Error(`Not a valid Shopify App Store URL: ${url}`);

  const byId = new Map<string, ShopifyReview>();
  let averageRating: number | null = null;
  let ratingCount: number | null = null;
  let distribution: { stars: number; count: number }[] = [];
  let lastStatus = 200;

  for (let page = 1; page <= MAX_PAGES; page++) {
    let outcome;
    try {
      outcome = await scrapeStatic(shopifyReviewsUrl(ref.handle, page));
    } catch (err) {
      // The first page IS the capture: a refusal or a failure there has to reach the
      // worker unchanged, so a 403 marks the source unscrapable and a timeout retries.
      // A later page failing is just the end of the window we could read.
      if (page === 1) throw err;
      break;
    }
    lastStatus = outcome.statusCode ?? lastStatus;

    const parsed = parseShopifyReviewsPage(outcome.html);
    if (page === 1) {
      // An app with no reviews still renders the ratings breakdown, so `isReviewsPage`
      // is what tells "nobody has reviewed this app" from "this is not the reviews
      // page". Only the second one is a failure; storing it as an empty baseline would
      // fake a flood of new reviews on the next healthy capture.
      if (!parsed.isReviewsPage) {
        throw new Error(`Shopify reviews page not recognized for app ${ref.handle}`);
      }
      averageRating = parsed.averageRating;
      ratingCount = parsed.ratingCount;
      distribution = parsed.distribution;
    }

    if (parsed.reviews.length === 0) break;
    for (const review of parsed.reviews) byId.set(review.id, review);
  }

  const reviews = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const snapshot: ShopifyReviewsSnapshot = {
    source: "shopify",
    handle: ref.handle,
    averageRating,
    ratingCount,
    distribution,
    reviews,
  };
  const html = JSON.stringify(snapshot);

  return {
    html,
    text: html,
    screenshotBuffer: Buffer.alloc(0),
    metadata: {
      source: "shopify",
      handle: ref.handle,
      reviewCount: reviews.length,
    },
    statusCode: lastStatus,
    level: 0, // server-rendered page read at L0, no browser, no proxy
    attempts: 1,
  };
}
