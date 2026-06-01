export const SOURCE_TYPES = [
  "homepage", "pricing", "blog", "changelog", "jobs",
  "g2_reviews", "capterra_reviews", "appstore_reviews",
  "linkedin", "twitter", "github_repo",
] as const;

export type SourceType = typeof SOURCE_TYPES[number];

const CONDITIONAL_FETCH_SOURCES: readonly SourceType[] = ["blog", "changelog"];

/**
 * Server-rendered sources where an HTTP 304 reliably means "unchanged".
 * Excludes SPAs (homepage/pricing — stable initial HTML hides client-side
 * changes), protected review sources, and jobs (ATS pages are often SPAs and a
 * false 304 would hide job-closure detection).
 */
export function supportsConditionalFetch(sourceType: SourceType): boolean {
  return CONDITIONAL_FETCH_SOURCES.includes(sourceType);
}

export interface ScrapingBeeTier {
  renderJs: boolean;
  premiumProxy: boolean;
}

/**
 * ScrapingBee is the paid fallback. `render_js` + `premium_proxy` (residential)
 * is the costly tier (~25 credits/call); a plain datacenter fetch is ~1. Only
 * sources behind real anti-bot justify the premium tier: homepage/pricing reach
 * the fallback *because* the direct attempt was blocked, and reviews (G2/Capterra/
 * AppStore) are always protected. ATS job boards are not anti-bot heavy — they
 * still need JS but not a premium proxy. Static content (blog/changelog) never
 * reaches ScrapingBee at all (Cheerio, direct-only) — listed here for intent.
 */
export function scrapingBeeTier(sourceType: SourceType): ScrapingBeeTier {
  switch (sourceType) {
    case "blog":
    case "changelog":
      return { renderJs: false, premiumProxy: false };
    case "jobs":
      return { renderJs: true, premiumProxy: false };
    default:
      return { renderJs: true, premiumProxy: true };
  }
}

export const MONITOR_FREQUENCIES = ["realtime", "daily", "weekly"] as const;
export type MonitorFrequency = typeof MONITOR_FREQUENCIES[number];

export const SIGNAL_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type SignalSeverity = typeof SIGNAL_SEVERITIES[number];

export const SIGNAL_CATEGORIES = [
  "pricing", "product", "hiring", "reviews", "content", "funding",
] as const;
export type SignalCategory = typeof SIGNAL_CATEGORIES[number];
