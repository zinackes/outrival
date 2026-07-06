import { scrapePage } from "../lib/crawler";
import type { ScrapeLevel, ScrapeOptions, ScrapeOutcome } from "../types";

/**
 * Review-page scrapers. Every review platform is a web page carrying a schema.org
 * AggregateRating (the structured-first score in extract-reviews) plus visible
 * review text (AI verbatims), so they all share one cascade path and differ only
 * by the minimum start level (anti-bot posture) and the `source` tag stamped on
 * the snapshot metadata. `reviewScraper` is that shared path; each export below is
 * a thin binding of it (g2/capterra are the originals, the rest are patch-32).
 */
function reviewScraper(source: string, minLevel: ScrapeLevel) {
  return async (
    _competitorId: string,
    url: string,
    options: ScrapeOptions = {},
  ): Promise<ScrapeOutcome> => {
    const knownLevel: ScrapeLevel =
      options.knownLevel && options.knownLevel > minLevel ? options.knownLevel : minLevel;
    const result = await scrapePage(url, { blockResources: true, knownLevel });
    return { ...result, metadata: { ...result.metadata, source } };
  };
}

// G2 / Capterra: protected, never start below datacenter (L2); a learned higher
// level (residential/Camoufox) is honored.
export const g2 = reviewScraper("g2", 2);
export const capterra = reviewScraper("capterra", 2);
// Trustpilot / TrustRadius: public but bot-aware → start at datacenter (L2), like
// g2/capterra; a learned higher level (residential/Camoufox) is honored.
export const trustpilot = reviewScraper("trustpilot", 2);
export const trustradius = reviewScraper("trustradius", 2);
// Gartner Peer Insights: heavily protected, frequently login-walled → start at
// residential (L3). Best-effort: a hard block escalates to L4 then marks the
// monitor unscrapable (fail-soft — never worse than not having the source).
export const gartner = reviewScraper("gartner", 3);
// Play Store: JS-rendered but not IP-blocked → needs a browser (L1), no proxy.
export const playstore = reviewScraper("playstore", 1);
