import { scrapePage } from "../lib/crawler";
import type { ScrapeOutcome, ScrapeOptions } from "../types";
import { discoverPricingUrl } from "./discover-url";

const PRICING_KEYWORDS = ["pricing", "tarifs", "plans", "tarification", "prix"];

export async function scrape(
  _competitorId: string,
  url: string,
  options: ScrapeOptions = {},
): Promise<ScrapeOutcome> {
  const knownLevel = options.knownLevel;

  // URL already points at a pricing page → scrape it directly.
  if (PRICING_KEYWORDS.some((k) => url.toLowerCase().includes(k))) {
    return scrapePage(url, { fullPage: true, knownLevel });
  }

  // Otherwise scrape the homepage and locate the real pricing page from it
  // (direct paths → nav → footer → embedded section).
  const homepage = await scrapePage(url, { fullPage: true, knownLevel });
  const candidate = await discoverPricingUrl(url, homepage.html);

  // Not found, or pricing is embedded in the homepage → analyse the homepage.
  if (!candidate || candidate.source === "homepage_section") {
    return homepage;
  }

  return scrapePage(candidate.url, { fullPage: true, knownLevel });
}
