import { scrapePage } from "../lib/crawler";
import type { ScrapeOutcome } from "../types";

/**
 * Scrape a G2 product reviews page. Always goes through the proxy —
 * G2 is known to be protected. The caller passes the full G2 URL.
 */
export async function scrape(_competitorId: string, url: string): Promise<ScrapeOutcome> {
  const result = await scrapePage(url, { fullPage: true, preferProxy: true });
  return {
    ...result,
    metadata: { ...result.metadata, source: "g2" },
  };
}
