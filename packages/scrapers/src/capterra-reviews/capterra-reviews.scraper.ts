import { scrapeViaScrapingBee } from "../lib/scrapingbee";
import type { ScraperResult } from "../types";

/**
 * Scrape a Capterra product reviews page through ScrapingBee.
 * The caller passes the full Capterra URL.
 */
export async function scrape(_competitorId: string, url: string): Promise<ScraperResult> {
  const result = await scrapeViaScrapingBee(url, { renderJs: true, premiumProxy: true });
  return {
    ...result,
    metadata: { ...result.metadata, source: "capterra" },
  };
}
