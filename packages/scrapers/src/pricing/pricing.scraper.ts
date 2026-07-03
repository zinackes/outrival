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
  // (direct paths → nav → footer → embedded section). Discover against the URL the
  // homepage ACTUALLY resolved to (post-redirect), not the stored monitor URL: an
  // apex host like `codebenders.ai` 301s only its root to `www.codebenders.ai` and
  // hard-404s every sub-path, so resolving a relative `/pricing` nav link against the
  // pre-redirect apex yields a dead URL. `metadata.url` is the final response URL.
  const homepage = await scrapePage(url, opts);
  const resolvedBase = (typeof homepage.metadata.url === "string" && homepage.metadata.url) || url;
  const candidate = await discoverPricingUrl(resolvedBase, homepage.html);

  // Not found, or pricing is embedded in the homepage → analyse the homepage.
  if (!candidate || candidate.source === "homepage_section") {
    return homepage;
  }

  return scrapePage(candidate.url, opts);
}
