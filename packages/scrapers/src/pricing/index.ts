// Pure pricing-analysis barrel — cheerio only, no crawlee/playwright. Imported
// by workers via the "@outrival/scrapers/pricing" subpath so scrape-monitor can
// use the detectors without pulling Chromium at module parse time.
export { analyzePricingHtml, extractDemoUrl } from "./analyze";
export type { PricingAnalysis } from "./analyze";
export { detectPricingSignals, emptySignals } from "./signals";
export type { PricingSignals } from "./signals";
export { determineStatus } from "./determine-status";
export type { StatusDecision } from "./determine-status";
export { discoverPricingUrl, discoverCommerceCandidates } from "./discover-url";
export type { PricingPageCandidate } from "./discover-url";
export {
  deriveProductLine,
  buildAggregatedDocument,
  splitProductLines,
} from "./product-lines";
export { pricingRatiosPlausible } from "./validate-ratios";
export type { PricingRatioPlan } from "./validate-ratios";
export { reconcileBillingPeriods } from "./normalize-periods";
export type { ReconcilablePlan } from "./normalize-periods";
export { detectTrial, NO_TRIAL } from "./detect-trial";
export type { TrialInfo } from "./detect-trial";
export { detectFreePlan } from "./detect-free-plan";
export { harvestPricing, parseAmount } from "./harvest";
export type { HarvestedPlan, PricingHarvest } from "./harvest";
export { parseEntitlementTable } from "./entitlement-table";
export type { ParsedEntitlement } from "./entitlement-table";
// Calculator probing (P4) — the PURE half only. The Playwright driver lives at
// ./calculator/probe and is exported from the main entry, so importing this
// barrel still never pulls Chromium in.
export { pickControl, reachableQuantities, MAX_PRICE_DISTANCE } from "./calculator/controls";
export type { ControlCandidate, PickedControl, ControlPick } from "./calculator/controls";
export { pickTotal, parseTotal, readsAsYearly } from "./calculator/readings";
export type { TotalCandidate, TotalPick } from "./calculator/readings";
export { findPricePath, readPricePath, pathnameOf } from "./calculator/endpoint";
export type { CapturedJson, PricePath } from "./calculator/endpoint";
