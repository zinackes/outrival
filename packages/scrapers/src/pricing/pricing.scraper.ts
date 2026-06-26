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
  // Pricing tables are commonly lazy-mounted / scroll-revealed (Framer `whileInView`
  // & co), so always scroll to reveal them before capture — on the dedicated page,
  // the homepage probe, and an embedded homepage section alike.
  const opts = { blockResources: true, knownLevel, progressiveScroll: true };

  // URL already points at a pricing page → scrape it directly.
  if (PRICING_KEYWORDS.some((k) => url.toLowerCase().includes(k))) {
    return scrapePage(url, opts);
  }

  // Otherwise scrape the homepage and locate the real pricing page from it
  // (direct paths → nav → footer → embedded section).
  const homepage = await scrapePage(url, opts);
  const candidate = await discoverPricingUrl(url, homepage.html);

  // Not found, or pricing is embedded in the homepage → analyse the homepage.
  if (!candidate || candidate.source === "homepage_section") {
    return homepage;
  }

  return scrapePage(candidate.url, opts);
}
