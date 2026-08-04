import type { SourceType } from "@outrival/shared";

// Plain-language label for a monitored source type, shown to users in the signal
// source line and the "Why this insight?" panel (patch-14). English only.
// Distinct from lib/scrape-errors PAGE_LABEL (that one phrases sources for error
// sentences); this one phrases them as a noun for "Source: <label>".

const SOURCE_LABELS: Record<string, string> = {
  homepage: "Homepage",
  pricing: "Pricing page",
  blog: "Blog",
  changelog: "Changelog",
  jobs: "Careers page",
  g2_reviews: "G2 reviews",
  capterra_reviews: "Capterra reviews",
  appstore_reviews: "App Store page",
  shopify_reviews: "Shopify App Store page",
  // Reviews v2: Trustpilot public surface (score + trend via the official API, no
  // scraped verbatims).
  trustpilot_public: "Trustpilot rating",
  // Self-product "developing" stage watches its GitHub repo (surfaces in Activity).
  github_repo: "GitHub repo",
  linkedin: "LinkedIn",
  twitter: "X / Twitter",
  // patch-18: signals from the independent tech-stack scraper.
  tech_stack: "Tech stack",
  // Company-level events from the Google News RSS anchor (funding/M&A/press).
  news: "News",
  // patch-32: additional review platforms (enable-on-demand).
  trustpilot_reviews: "Trustpilot reviews",
  trustradius_reviews: "TrustRadius reviews",
  gartner_reviews: "Gartner reviews",
  playstore_reviews: "Play Store reviews",
  // patch-31: competitor status page (incidents / uptime).
  status: "Status page",
  // patch-32: internal sitemap-diff anchor (new/removed pages).
  sitemap: "Sitemap",
  // Internal Certificate-Transparency anchor (new live subdomains).
  subdomains: "Subdomains",
  // Internal YouTube-channel anchor (new video uploads).
  youtube: "YouTube",
  // Internal anchor for rising review complaint-theme signals (no page scraped).
  review_shift: "Review trends",
  // Internal anchor for hiring velocity inflections (no page scraped).
  hiring_shift: "Hiring trends",
  // Internal anchor for facts mined out of job descriptions (no page scraped).
  job_facts: "Job description signals",
  // Internal anchor for where they hire (new country, new department, freeze).
  hiring_footprint: "Hiring footprint",
  // Internal anchor for salary-band moves and the start of pay disclosure.
  hiring_salary: "Salary bands",
  // Internal Hacker News anchor (Show HN launches + traction mentions).
  hackernews: "Hacker News",
  // Internal well-known / domain-fingerprint anchor (mobile-app launch, llms.txt).
  wellknown: "App & AI footprint",
  // Internal comparison-page anchor (competitor /vs/ + alternative pages).
  comparison_page: "Comparison page",
  // Internal anchor for calculator-measured cost moves (no page scraped).
  pricing_probe: "Calculator pricing",
  // Internal anchor for release-cadence moves counted off content_items.
  shipping_velocity: "Shipping velocity",
  // Internal anchor for published case studies + first-seen customer names.
  customer_proof: "Customer proof",
  // Internal anchor for a blog whose mix of subjects moved against its own quarter.
  editorial_shift: "Editorial shift",
  // Internal anchor for a top-voted roadmap request moving into planned work.
  roadmap_shift: "Roadmap move",
  // Internal anchor for integrations a competitor newly lists in its catalog.
  integration_catalog: "Integrations",
  // Developer documentation (pro+): OpenAPI spec diff, else docs page list.
  docs: "Developer docs",
  // User-watched arbitrary page on the competitor's domain ("Watch a custom page").
  custom: "Custom page",
  // Public roadmap / feedback portal (pro+): Canny or ProductBoard.
  roadmap: "Roadmap portal",
};

export function sourceLabel(sourceType: string | null | undefined): string {
  if (!sourceType) return "Monitored page";
  return SOURCE_LABELS[sourceType] ?? "Monitored page";
}

// Short, Title-cased label for a source type — used as a noun title in source
// lists, chips and plan source listings (e.g. "Jobs", "G2 reviews"). Exhaustive
// over SourceType so a new source forces a label here. English only.
export const SOURCE_SHORT_LABELS: Record<SourceType, string> = {
  homepage: "Homepage",
  pricing: "Pricing page",
  blog: "Blog",
  changelog: "Changelog",
  jobs: "Jobs",
  g2_reviews: "G2 reviews",
  capterra_reviews: "Capterra reviews",
  appstore_reviews: "App Store reviews",
  shopify_reviews: "Shopify App Store reviews",
  trustpilot_public: "Trustpilot rating",
  trustpilot_reviews: "Trustpilot reviews",
  trustradius_reviews: "TrustRadius reviews",
  gartner_reviews: "Gartner reviews",
  playstore_reviews: "Play Store reviews",
  linkedin: "LinkedIn",
  twitter: "Twitter / X",
  github_repo: "GitHub repo",
  tech_stack: "Tech stack",
  status: "Status page",
  sitemap: "Sitemap",
  news: "News",
  ai_visibility: "AI visibility",
  subdomains: "Subdomains",
  youtube: "YouTube",
  review_shift: "Review trends",
  hiring_shift: "Hiring trends",
  job_facts: "Job description signals",
  hiring_footprint: "Hiring footprint",
  hiring_salary: "Salary bands",
  hackernews: "Hacker News",
  wellknown: "App & AI footprint",
  comparison_page: "Comparison page",
  pricing_probe: "Calculator pricing",
  shipping_velocity: "Shipping velocity",
  customer_proof: "Customer proof",
  editorial_shift: "Editorial shift",
  roadmap_shift: "Roadmap move",
  integration_catalog: "Integrations",
  docs: "Developer docs",
  custom: "Custom page",
  roadmap: "Roadmap portal",
};

export function sourceShortLabel(sourceType: string | null | undefined): string {
  if (!sourceType) return "Source";
  return SOURCE_SHORT_LABELS[sourceType as SourceType] ?? sourceType;
}
