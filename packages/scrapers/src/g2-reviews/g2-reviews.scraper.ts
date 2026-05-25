import { scrapeViaScrapingBee } from "../lib/scrapingbee";
import type { ScraperResult } from "../types";

/**
 * Scrape a G2 product reviews page through ScrapingBee.
 * The caller passes the full G2 URL (e.g. https://www.g2.com/products/<slug>/reviews).
 */
export async function scrape(_competitorId: string, url: string): Promise<ScraperResult> {
  const result = await scrapeViaScrapingBee(url, { renderJs: true, premiumProxy: true });
  return {
    ...result,
    metadata: { ...result.metadata, source: "g2" },
  };
}
