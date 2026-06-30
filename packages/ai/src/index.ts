export { AI_CONFIG } from "./config";
export type { AIProvider, AITaskConfig } from "./config";
export { complete } from "./provider";
// Provider pool + resilience (patch-22)
export { getActiveProvider, consumeUsage } from "./provider/provider-context";
export type { TokenUsage } from "./provider/provider-context";
export { AIUnavailableError, checkGlobalBreaker } from "./provider/circuit-breaker";
export { loadProviders } from "./provider/provider-pool";
export type { Provider } from "./provider/provider-pool";
export { safeParseJson } from "./lib/parse";
// Anti-hallucination: grounding + self-check (patch-24)
export { groundedAiCall } from "./grounding/grounded-call";
export { validateCitations, normalizeText } from "./grounding/citations";
export type { Citation, GroundingValidation } from "./grounding/citations";
export { attachQuality, emptyQuality } from "./grounding/types";
export { runSelfCheck, decideIfSelfCheck } from "./self-check/run-self-check";
export type {
  Confidence,
  GroundedQuality,
  GroundedResult,
  GroundedCallParams,
  SelfCheckResult,
  SelfCheckTrigger,
  WithQuality,
} from "./grounding/types";
export { classifyChange, ClassificationSchema } from "./tasks/classify";
export type { Classification } from "./tasks/classify";
export { classifyStructuredChanges } from "./tasks/classify-structured";
export type {
  StructuredChangeInput,
  PerChangeAssessment,
  StructuredClassification,
} from "./tasks/classify-structured";
export { narrateChange, shouldNarrate } from "./tasks/narrate-change";
export type { NarrateChangeInput } from "./tasks/narrate-change";
export { generateInsight, buildInsightPrompt, toMyProductContext } from "./tasks/insight";
export { InsightSchema } from "./tasks/insight";
export type { Insight, MyProductContext } from "./tasks/insight";
export { generateBatchSummary } from "./tasks/batch-summary";
export type { BatchSummaryInput } from "./tasks/batch-summary";
export { generateRepositioningInsight } from "./tasks/pricing-repositioning";
export type { RepositioningInput } from "./tasks/pricing-repositioning";
export { generateDigest, DigestSchema } from "./tasks/digest";
export type { Digest, DigestInputSignal } from "./tasks/digest";
export {
  analyzeProduct,
  ProductProfileSchema,
  buildDiscoveryQuery,
  selfProfileToDiscoveryProfile,
} from "./tasks/analyze-product";
export type { ProductProfile, SelfProfileLike } from "./tasks/analyze-product";
export { fromDescription, fromDocument, fromRepo, fromUrl } from "./profile";
export type { FromDescriptionInput, RepoArtifacts } from "./profile";
export { scoreOverlap } from "./tasks/score-overlap";
export type { Candidate, ScoredCandidate } from "./tasks/score-overlap";
export { extractPricing, PricingSchema, PricingPlanSchema } from "./tasks/extract-pricing";
export type { PricingExtraction, PricingPlan } from "./tasks/extract-pricing";
export { extractJobs, JobsSchema, JobPostingSchema } from "./tasks/extract-jobs";
export type { JobsExtraction, ExtractedJob } from "./tasks/extract-jobs";
export { extractReviews, ReviewsSchema } from "./tasks/extract-reviews";
export {
  extractAiVisibility,
  AiVisibilityExtractionSchema,
  AiVisibilityMentionSchema,
} from "./tasks/extract-ai-visibility";
export type {
  AiVisibilityExtraction,
  AiVisibilityMention,
} from "./tasks/extract-ai-visibility";
export type { ReviewsExtraction } from "./tasks/extract-reviews";
export { generateExtractor } from "./tasks/generate-extractor";
export type { ExtractorKind } from "./tasks/generate-extractor";
export { generateCompetitorSummary, SummarySchema } from "./tasks/competitor-summary";
export type { CompetitorSummary, CompetitorSummaryInput } from "./tasks/competitor-summary";
export { summarizeSource, SourceSummarySchema } from "./tasks/summarize-source";
export type { SourceSummary, SourceSummaryInput } from "./tasks/summarize-source";
export { generateBattleCard, BattleCardSchema } from "./tasks/battle-card";
export type { BattleCardContent, BattleCardInput } from "./tasks/battle-card";
// Ask Outrival — conversational intelligence (tool-agent planner + grounded synthesis)
export {
  AskPlanSchema,
  AskAnswerSchema,
  AskCitationSchema,
  buildAskPlanPrompt,
  buildAskSynthesisPrompt,
} from "./tasks/ask";
export type { AskPlan, AskAnswer, AskToolSpec, AskRosterEntry } from "./tasks/ask";
export { evaluateSignificance } from "./filters/significance";
export type { DiffInput, SignificanceResult } from "./filters/significance";
export { extractSelfProfile, SelfProfileExtractionSchema } from "./tasks/extract-self-profile";
export type { SelfProfileExtraction } from "./tasks/extract-self-profile";
export { verifyContentMatchesProfile, VerifyContentSchema } from "./tasks/verify-content-profile";
export type { VerifyContentResult, VerifyContentInput } from "./tasks/verify-content-profile";
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
