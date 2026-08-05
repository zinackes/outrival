import * as homepage from "./homepage/homepage.scraper";
import * as pricing from "./pricing/pricing.scraper";
import * as blog from "./blog/blog.scraper";
import * as changelog from "./changelog/changelog.scraper";
import * as jobs from "./jobs/jobs.scraper";
import * as appstoreReviews from "./appstore-reviews/appstore-reviews.scraper";
import * as shopifyReviews from "./shopify-reviews/shopify-reviews.scraper";
import * as trustpilot from "./trustpilot/trustpilot.scraper";
import * as github from "./github/github.scraper";
import * as status from "./status/status.scraper";
import * as sitemap from "./sitemap/sitemap.scraper";
import * as news from "./news/news.scraper";
import * as subdomains from "./subdomains/subdomains.scraper";
import * as youtube from "./youtube/youtube.scraper";
import * as hackernews from "./hackernews/hackernews.scraper";
import * as wellknown from "./wellknown/wellknown.scraper";
import * as docs from "./docs/docs.scraper";
import * as custom from "./custom/custom.scraper";
import * as roadmap from "./roadmap/roadmap.scraper";
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
  // Reviews v2 (2026-07-15): App Store (public RSS) is the only directly-read review
  // source with verbatims. The scraped aggregators (g2/capterra/trustpilot_reviews/
  // trustradius/gartner/playstore) are retired — no scraper binding, so getScraper
  // throws if a dormant, marked_unscrapable monitor were ever scheduled (it never is).
  appstore_reviews: appstoreReviews.scrape,
  // Shopify App Store (2026-08-04): a public server-rendered listing read at L0
  // through scrapeStatic, so robots.txt + the per-domain gap apply like anywhere
  // else. Score + count come from the page's own JSON-LD AggregateRating.
  shopify_reviews: shopifyReviews.scrape,
  // Trustpilot public surface — official API (TRUSTPILOT_API_KEY): score + count +
  // distribution only, never scraped verbatims. Throws cleanly if the key is unset.
  trustpilot_public: trustpilot.scrape,
  github_repo: github.scrape,
  status: status.scrape,
  sitemap: sitemap.scrape,
  news: news.scrape,
  subdomains: subdomains.scrape,
  youtube: youtube.scrape,
  hackernews: hackernews.scrape,
  wellknown: wellknown.scrape,
  // Developer docs (pro+): OpenAPI spec → canonical operation/schema listing, else
  // the docs sitemap's page list. Pure fetch, no browser cascade, no AI.
  docs: docs.scrape,
  custom: custom.scrape,
  // Public roadmap / feedback portal (pro+): Canny's SSR'd state island or
  // ProductBoard's unauthenticated portal API → a listing sorted by stable entry id.
  // Pure fetch, no browser cascade, no AI.
  roadmap: roadmap.scrape,
};

export function getScraper(sourceType: SourceType): ScraperFn {
  const scraper = scrapers[sourceType];
  if (!scraper) throw new Error(`No scraper for source type: ${sourceType}`);
  return scraper;
}

// Run-end browser teardown (see lib/scrape-page). A job that may have rendered
// must call this so a long-lived worker doesn't leak browsers across scrapes.
export { closeScraperBrowsers } from "./lib/scrape-page";

// The SOURCE-AGNOSTIC cascade entry (robots, per-domain gap, L0→render, refusal
// doctrine), exported for the one caller that must NOT go through getScraper: the
// P2 verification re-capture. A source scraper does path discovery and, for some
// sources, asks for a screenshot — which floors the cascade at a render and would
// re-capture a `static` original with a browser, comparing two different things.
export { scrapePage, scrapeStatic, ScrapeFailedError } from "./lib/crawler";

export type { ScraperResult, ScrapeOptions, ScrapeOutcome } from "./types";
export { findSimilarCompanies } from "./discovery/discover";
export type { DiscoveredCompany } from "./discovery/discover";
export { quickFetchText } from "./lib/quick-fetch";
export { analyzePricingHtml, extractDemoUrl } from "./pricing/analyze";
export type { PricingAnalysis } from "./pricing/analyze";
export { detectPricingSignals } from "./pricing/signals";
export type { PricingSignals } from "./pricing/signals";
export { discoverPricingUrl } from "./pricing/discover-url";
// Pricing calculator probe (P4) — drives a competitor's public calculator with a
// browser, so it lives here (Chromium) rather than on the pure ./pricing subpath.
export { probeCalculator, PROBE_PLAN_NAME } from "./pricing/calculator/probe";
export type {
  ProbeOptions,
  ProbeOutcome,
  ProbeSuccess,
  ProbeRefusal,
  ProbeFailure,
  ProbeEvidence,
  ProbeStrategy,
} from "./pricing/calculator/probe";
export { scrapeWithApiCapture } from "./spa/api-capture";
export type { SpaCaptureResult } from "./spa/api-capture";
export {
  filterRelevantApiCalls,
  apiCallsToText,
  apiCallsToHtmlDoc,
  toEndpoints,
} from "./spa/filter";
export type { CapturedApiCall, CapturedEndpoint } from "./spa/filter";
