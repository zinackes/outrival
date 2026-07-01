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
  // Self-product "developing" stage watches its GitHub repo (surfaces in Activity).
  github_repo: "GitHub repo",
  linkedin: "LinkedIn",
  twitter: "X / Twitter",
  // patch-18: signals from the independent tech-stack scraper.
  tech_stack: "Tech stack",
  // Company-level events from the Google News RSS anchor (funding/M&A/press).
  news: "News",
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
  trustpilot_reviews: "Trustpilot reviews",
  trustradius_reviews: "TrustRadius reviews",
  gartner_reviews: "Gartner reviews",
  playstore_reviews: "Play Store reviews",
  reddit: "Reddit mentions",
  linkedin: "LinkedIn",
  twitter: "Twitter / X",
  github_repo: "GitHub repo",
  tech_stack: "Tech stack",
  status: "Status page",
  sitemap: "Sitemap",
  news: "News",
  ai_visibility: "AI visibility",
};

export function sourceShortLabel(sourceType: string | null | undefined): string {
  if (!sourceType) return "Source";
  return SOURCE_SHORT_LABELS[sourceType as SourceType] ?? sourceType;
}
