export const SOURCE_TYPES = [
  "homepage", "pricing", "blog", "changelog", "jobs",
  "g2_reviews", "capterra_reviews", "appstore_reviews",
  "linkedin", "twitter",
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

export const MONITOR_FREQUENCIES = ["realtime", "daily", "weekly"] as const;
export type MonitorFrequency = typeof MONITOR_FREQUENCIES[number];

export const SIGNAL_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type SignalSeverity = typeof SIGNAL_SEVERITIES[number];

export const SIGNAL_CATEGORIES = [
  "pricing", "product", "hiring", "reviews", "content", "funding",
] as const;
export type SignalCategory = typeof SIGNAL_CATEGORIES[number];
