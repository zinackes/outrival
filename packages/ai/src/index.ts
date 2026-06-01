export { AI_CONFIG } from "./config";
export type { AIProvider, AITaskConfig } from "./config";
export { complete } from "./provider";
export { safeParseJson } from "./lib/parse";
export { classifyChange, ClassificationSchema } from "./tasks/classify";
export type { Classification } from "./tasks/classify";
export { generateInsight, InsightSchema } from "./tasks/insight";
export type { Insight } from "./tasks/insight";
export { generateRepositioningInsight } from "./tasks/pricing-repositioning";
export type { RepositioningInput } from "./tasks/pricing-repositioning";
export { generateDigest, DigestSchema } from "./tasks/digest";
export type { Digest, DigestInputSignal } from "./tasks/digest";
export { analyzeProduct, ProductProfileSchema, buildDiscoveryQuery } from "./tasks/analyze-product";
export type { ProductProfile } from "./tasks/analyze-product";
export { fromDescription, fromDocument, fromRepo, fromUrl } from "./profile";
export type { FromDescriptionInput, RepoArtifacts } from "./profile";
export { scoreOverlap } from "./tasks/score-overlap";
export type { Candidate, ScoredCandidate } from "./tasks/score-overlap";
export { extractPricing, PricingSchema, PricingPlanSchema } from "./tasks/extract-pricing";
export type { PricingExtraction, PricingPlan } from "./tasks/extract-pricing";
export { extractJobs, JobsSchema, JobPostingSchema } from "./tasks/extract-jobs";
export type { JobsExtraction, ExtractedJob } from "./tasks/extract-jobs";
export { extractReviews, ReviewsSchema } from "./tasks/extract-reviews";
export type { ReviewsExtraction } from "./tasks/extract-reviews";
export { generateCompetitorSummary, SummarySchema } from "./tasks/competitor-summary";
export type { CompetitorSummary, CompetitorSummaryInput } from "./tasks/competitor-summary";
export { summarizeSource, SourceSummarySchema } from "./tasks/summarize-source";
export type { SourceSummary, SourceSummaryInput } from "./tasks/summarize-source";
export { generateBattleCard, BattleCardSchema } from "./tasks/battle-card";
export type { BattleCardContent, BattleCardInput } from "./tasks/battle-card";
export { evaluateSignificance } from "./filters/significance";
export type { DiffInput, SignificanceResult } from "./filters/significance";
export { extractSelfProfile, SelfProfileExtractionSchema } from "./tasks/extract-self-profile";
export type { SelfProfileExtraction } from "./tasks/extract-self-profile";
export {
  detectFeatureTrends,
  detectHiringTrends,
  detectPricingTrends,
  detectPositioningShifts,
  FEATURE_THEMES,
} from "./sectoral/detectors";
export { formulateSectoralSignal, SectoralSignalDraftSchema } from "./sectoral/formulate";
export type { SectoralSignalDraft, SectoralUserContext } from "./sectoral/formulate";
export type {
  SectoralCategory,
  DetectedPattern,
  PatternEvidence,
  CompetitorRef,
  CompetitorSectoralData,
  ProductSignalInput,
  JobInput,
  PricePointInput,
  PricingStatusPointInput,
} from "./sectoral/types";
