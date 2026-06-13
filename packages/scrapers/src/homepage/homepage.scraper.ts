import { scrapePage } from "../lib/crawler";
import type { ScrapeOutcome, ScrapeOptions } from "../types";

export async function scrape(
  _competitorId: string,
  url: string,
  options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  return scrapePage(url, {
    fullPage: true,
    // The only source that needs a screenshot: the patch-17 pHash visual-redesign
    // detector runs on homepage snapshots. Keep all resources (CSS/images) so the
    // screenshot renders faithfully.
    screenshot: true,
    knownLevel: options.knownLevel,
    // patch-16: reveal lazy-loaded / below-the-fold content before capture.
    // Homepage-only — other sources don't request it.
    progressiveScroll: true,
  });
}
