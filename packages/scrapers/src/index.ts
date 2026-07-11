import * as homepage from "./homepage/homepage.scraper";
import * as pricing from "./pricing/pricing.scraper";
import * as blog from "./blog/blog.scraper";
import * as changelog from "./changelog/changelog.scraper";
import * as jobs from "./jobs/jobs.scraper";
import * as appstoreReviews from "./appstore-reviews/appstore-reviews.scraper";
import * as extraReviews from "./reviews/extra-platforms.scraper";
import * as reddit from "./reddit/reddit.scraper";
import * as github from "./github/github.scraper";
import * as status from "./status/status.scraper";
import * as sitemap from "./sitemap/sitemap.scraper";
import * as news from "./news/news.scraper";
import * as subdomains from "./subdomains/subdomains.scraper";
import * as youtube from "./youtube/youtube.scraper";
import type { SourceType } from "@outrival/shared";
import type { ScrapeOptions, ScrapeOutcome } from "./types";

type ScraperFn = (
  competitorId: string,
  url: string,
  options?: ScrapeOptions,
) => Promise<ScrapeOutcome>;

const scrapers: Partial<Record<SourceType, ScraperFn>> = {
  homepage: homepage.scrape,
  pricing: pricing.scrape,
  blog: blog.scrape,
  changelog: changelog.scrape,
  jobs: jobs.scrape,
  g2_reviews: extraReviews.g2,
  capterra_reviews: extraReviews.capterra,
  appstore_reviews: appstoreReviews.scrape,
  trustpilot_reviews: extraReviews.trustpilot,
  trustradius_reviews: extraReviews.trustradius,
  gartner_reviews: extraReviews.gartner,
  playstore_reviews: extraReviews.playstore,
  reddit: reddit.scrape,
  github_repo: github.scrape,
  status: status.scrape,
  sitemap: sitemap.scrape,
  news: news.scrape,
  subdomains: subdomains.scrape,
  youtube: youtube.scrape,
};

export function getScraper(sourceType: SourceType): ScraperFn {
  const scraper = scrapers[sourceType];
  if (!scraper) throw new Error(`No scraper for source type: ${sourceType}`);
  return scraper;
}

// Run-end browser teardown (see lib/scrape-page). A job that may have rendered
// must call this so a long-lived worker doesn't leak browsers across scrapes.
export { closeScraperBrowsers } from "./lib/scrape-page";

export type { ScraperResult, ScrapeOptions, ScrapeOutcome } from "./types";
export { findSimilarCompanies } from "./discovery/discover";
export type { DiscoveredCompany } from "./discovery/discover";
export { quickFetchText } from "./lib/quick-fetch";
export { analyzePricingHtml, extractDemoUrl } from "./pricing/analyze";
export type { PricingAnalysis } from "./pricing/analyze";
export { detectPricingSignals } from "./pricing/signals";
export type { PricingSignals } from "./pricing/signals";
export { discoverPricingUrl } from "./pricing/discover-url";
export { scrapeWithApiCapture } from "./spa/api-capture";
export type { SpaCaptureResult } from "./spa/api-capture";
export {
  filterRelevantApiCalls,
  apiCallsToText,
  apiCallsToHtmlDoc,
  toEndpoints,
} from "./spa/filter";
export type { CapturedApiCall, CapturedEndpoint } from "./spa/filter";
