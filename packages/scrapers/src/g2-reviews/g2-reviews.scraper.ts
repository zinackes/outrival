import { scrapePage } from "../lib/crawler";
import type { ScrapeOptions, ScrapeOutcome } from "../types";

/**
 * Scrape a G2 product reviews page. G2 is known to be protected, so the cascade
 * never starts below L2 (datacenter) — L0/L1 (direct/server IP) would just waste
 * attempts. A learned higher level (residential/Camoufox) is honored.
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
    metadata: { ...result.metadata, source: "g2" },
  };
}
