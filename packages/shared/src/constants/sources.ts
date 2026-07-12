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
  // AI Visibility / "Share of Model" (docs/ai-visibility.md). Like tech_stack, an
  // INTERNAL anchor source — never user-selectable (excluded from plan gating, the
  // enable route, and the source tabs). It only anchors the synthetic visibility
  // signal's snapshot→change chain; the capability is gated by features.aiVisibility,
  // and the data lives in ai_visibility_prompts/_results. Kept in sync with the DB enum.
  "ai_visibility",
  // Subdomains via Certificate Transparency (crt.sh). Like sitemap/news, an
  // INTERNAL source — never user-selectable (excluded from plan gating, the enable
  // route, and the source tabs). Seeded daily at creation; the scraper emits the
  // sorted list of LIVE subdomains → the generic diff surfaces a brand-new one
  // (beta./ai./{product}.) as an expansion / pre-announcement product signal.
  // Kept in sync with the DB source_type enum.
  "subdomains",
  // YouTube channel videos (official videos.xml RSS). Like sitemap/news, an
  // INTERNAL source — never user-selectable (excluded from plan gating, the enable
  // route, and the source tabs). Seeded weekly at creation; the scraper resolves the
  // channel from a homepage link and emits a sorted video list → the generic diff
  // surfaces a brand-new upload as a content signal. Kept in sync with the DB enum.
  "youtube",
  // Review complaint-theme shifts. Like tech_stack / ai_visibility, an INTERNAL
  // anchor source — never user-selectable (excluded from plan gating, the enable
  // route, and the source tabs). It only anchors the synthetic snapshot→change
  // chain when a recurring complaint theme inflects upward over the review_scores
  // time-series (detect-review-theme-shifts). Kept in sync with the DB enum.
  "review_shift",
  // Custom page. User-selectable, but via a DEDICATED flow ("Watch a custom page")
  // — NOT the standard enable list (rejected on POST /:id/monitors). Watches ANY
  // page on the competitor's own registrable domain (/about, ToS, /security,
  // /enterprise, a docs page) through the full snapshot → lexical diff → classify →
  // signal pipeline. config = { url, label, hint }; the hint (legal|team|product|
  // security|docs|other) grounds classify. Per-competitor quota
  // (PLAN_LIMITS.customMonitorsPerCompetitor), NOT the single (competitor,sourceType)
  // uniqueness — several customs coexist per competitor. Kept in sync with the DB enum.
  "custom",
] as const;

export type SourceType = typeof SOURCE_TYPES[number];

/**
 * Reddit source kill-switch (default OFF). Reddit's free-tier app creation is gated
 * behind the Responsible Builder Policy approval (June 2026), so without approved
 * GLOBAL OAuth creds (REDDIT_CLIENT_ID/SECRET) the source can't be enabled for anyone
 * — every scrape would just fail. Disabled → hidden from the source picker (web) and
 * rejected by the enable endpoint (API/onboarding). Flip NEXT_PUBLIC_REDDIT_ENABLED
 * to "true" once creds are provisioned. Public flag so the web client can read it too;
 * the API/workers read the same name at runtime.
 */
export function isRedditEnabled(): boolean {
  return process.env.NEXT_PUBLIC_REDDIT_ENABLED === "true";
}

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
