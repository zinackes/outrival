import { scrapePage, scrapeFirstSuccess } from "../lib/crawler";
import type { ScrapeOutcome, ScrapeOptions } from "../types";

const PRICING_PATHS = ["/pricing", "/tarifs", "/plans", "/price"];

const PRICING_KEYWORDS = ["pricing", "tarifs", "plans", "tarification"];

export async function scrape(
  _competitorId: string,
  url: string,
  options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const lowered = url.toLowerCase();
  if (PRICING_KEYWORDS.some((k) => lowered.includes(k))) {
    return scrapePage(url, { fullPage: true, preferProxy: options.preferProxy });
  }
  return scrapeFirstSuccess(url, PRICING_PATHS, (u) =>
    scrapePage(u, { fullPage: true, preferProxy: options.preferProxy }),
  );
}
