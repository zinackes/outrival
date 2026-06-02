import { scrapePage } from "../lib/crawler";
import type { ScrapeOptions, ScrapeOutcome } from "../types";

/**
 * Scrape a Capterra product reviews page. Capterra is known to be protected, so
 * the cascade never starts below L2 (datacenter); a learned higher level is kept.
 */
export async function scrape(
  _competitorId: string,
  url: string,
  options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const knownLevel = options.knownLevel && options.knownLevel > 2 ? options.knownLevel : 2;
  const result = await scrapePage(url, { fullPage: true, knownLevel });
  return {
    ...result,
    metadata: { ...result.metadata, source: "capterra" },
  };
}
