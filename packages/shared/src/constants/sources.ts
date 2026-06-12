export const SOURCE_TYPES = [
  "homepage", "pricing", "blog", "changelog", "jobs",
  "g2_reviews", "capterra_reviews", "appstore_reviews",
  // patch-32: additional review platforms (enable-on-demand, explicit URL, pro+).
  // Structured-first AggregateRating + AI verbatims, same path as g2/capterra.
  "trustpilot_reviews", "trustradius_reviews", "gartner_reviews", "playstore_reviews",
  // patch-32: Reddit mention tracking. NOT a `_reviews` source (no per-competitor
  // review URL / star rating) — searched by brand, judged for sentiment + complaint
  // themes by extract-reviews. Enable on-demand pro+.
  "reddit",
  "linkedin", "twitter", "github_repo",
  // patch-18: infra-only anchor source for tech-stack signals. Never user-
  // selectable (excluded from plan gating, monitor creation routes, and the
  // competitor source tabs); kept in sync with the DB source_type enum so
  // monitor.sourceType stays assignable to SourceType across the pipeline.
  "tech_stack",
  // patch-31: competitor status page (Statuspage/Instatus JSON summary). Enabled
  // on demand (starter+) when platform detection found a statusPage. Kept in sync
  // with the DB source_type enum.
  "status",
  // patch-32: sitemap discovery anchor. Like tech_stack, an INTERNAL source — never
  // user-selectable (excluded from plan gating, the enable route, and the source
  // tabs). Seeded weekly at competitor creation; the scraper emits the sorted URL
  // list so the generic diff surfaces brand-new pages. Kept in sync with the DB
  // source_type enum.
  "sitemap",
  // News / funding (company-level events). Like sitemap, an INTERNAL source —
  // never user-selectable (excluded from plan gating, the enable route, and the
  // source tabs). Seeded weekly at creation; the scraper queries Google News RSS
  // by brand and emits a sorted snapshot → the generic diff surfaces new events
  // (classify tags funding/product/hiring). Kept in sync with the DB enum.
  "news",
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
