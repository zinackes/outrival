import { scrapePage, scrapeFirstSuccess } from "../lib/crawler";
import type { ScraperResult } from "../types";

const PRICING_PATHS = ["/pricing", "/tarifs", "/plans", "/price"];

const PRICING_KEYWORDS = ["pricing", "tarifs", "plans", "tarification"];

export async function scrape(_competitorId: string, url: string): Promise<ScraperResult> {
  const lowered = url.toLowerCase();
  if (PRICING_KEYWORDS.some((k) => lowered.includes(k))) {
    return scrapePage(url, { fullPage: true });
  }
  return scrapeFirstSuccess(url, PRICING_PATHS, (u) => scrapePage(u, { fullPage: true }));
}
