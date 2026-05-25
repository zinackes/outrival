import { scrapePage } from "../lib/crawler";
import type { ScraperResult } from "../types";

export async function scrape(_competitorId: string, url: string): Promise<ScraperResult> {
  return scrapePage(url, { fullPage: true });
}
