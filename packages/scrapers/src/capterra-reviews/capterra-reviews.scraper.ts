import { scrapePage } from "../lib/crawler";
import type { ScrapeOutcome } from "../types";

/**
 * Scrape a Capterra product reviews page. Always goes through the proxy —
 * Capterra is known to be protected.
 */
export async function scrape(_competitorId: string, url: string): Promise<ScrapeOutcome> {
  const result = await scrapePage(url, { fullPage: true, preferProxy: true });
  return {
    ...result,
    metadata: { ...result.metadata, source: "capterra" },
  };
}
