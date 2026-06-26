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
    // detector AND the before/after visual diff both run on homepage snapshots.
    // Keep all resources (CSS/images) so the capture renders faithfully. Requesting
    // a screenshot floors the cascade at L1 (a browser render — L0 fetch can't
    // screenshot), so it costs a browser pass on every homepage scrape. The
    // kill-switch lets ops drop back to the cheap L0 fetch (no screenshot → no
    // visual diff / pHash) without a deploy if the browser load bites the VPS.
    screenshot: process.env.HOMEPAGE_SCREENSHOT_ENABLED !== "false",
    knownLevel: options.knownLevel,
    // patch-16: reveal lazy-loaded / below-the-fold content before capture.
    // Homepage-only — other sources don't request it.
    progressiveScroll: true,
  });
}
