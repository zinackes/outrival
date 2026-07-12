import { scrapePage } from "../lib/crawler";
import type { ScrapeOutcome, ScrapeOptions } from "../types";

/**
 * Custom-page connector. Watches an arbitrary page on the competitor's own
 * registrable domain (/about, ToS, /security, /enterprise, a docs page) that the
 * user picked in the "Watch a custom page" flow. The exact URL is stored in
 * `monitor.config.url`, so there is no path discovery — we just capture that one
 * page through the full cascade (which renders JS / handles protection) and hand
 * it to the generic snapshot → lexical diff → classify pipeline.
 *
 * Deliberately minimal vs the homepage scraper: no screenshot, no progressive
 * scroll, no structure parsing — those are homepage-only enrichments. A custom
 * page is a single fixed URL whose text diff carries the signal.
 */
export async function scrape(
  _competitorId: string,
  url: string,
  options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  return scrapePage(url, {
    fullPage: true,
    knownLevel: options.knownLevel,
  });
}
