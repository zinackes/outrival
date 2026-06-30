// Pure pricing-analysis barrel — cheerio only, no crawlee/playwright. Imported
// by workers via the "@outrival/scrapers/pricing" subpath so scrape-monitor can
// use the detectors without pulling Chromium at module parse time.
export { analyzePricingHtml, extractDemoUrl } from "./analyze";
export type { PricingAnalysis } from "./analyze";
export { detectPricingSignals, emptySignals } from "./signals";
export type { PricingSignals } from "./signals";
export { determineStatus } from "./determine-status";
export type { StatusDecision } from "./determine-status";
export { discoverPricingUrl } from "./discover-url";
export type { PricingPageCandidate } from "./discover-url";
export { pricingRatiosPlausible } from "./validate-ratios";
export type { PricingRatioPlan } from "./validate-ratios";
export { detectTrial, NO_TRIAL } from "./detect-trial";
export type { TrialInfo } from "./detect-trial";
