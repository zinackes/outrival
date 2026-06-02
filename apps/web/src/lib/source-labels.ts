// Plain-language label for a monitored source type, shown to users in the signal
// source line and the "Why this insight?" panel (patch-14). English only.
// Distinct from lib/scrape-errors PAGE_LABEL (that one phrases sources for error
// sentences); this one phrases them as a noun for "Source: <label>".

const SOURCE_LABELS: Record<string, string> = {
  homepage: "homepage",
  pricing: "pricing page",
  blog: "blog",
  changelog: "changelog",
  jobs: "careers page",
  g2_reviews: "G2 reviews",
  capterra_reviews: "Capterra reviews",
  appstore_reviews: "App Store page",
  linkedin: "LinkedIn",
  twitter: "X / Twitter",
  // patch-18: signals from the independent tech-stack scraper.
  tech_stack: "tech stack",
};

export function sourceLabel(sourceType: string | null | undefined): string {
  if (!sourceType) return "monitored page";
  return SOURCE_LABELS[sourceType] ?? "monitored page";
}
