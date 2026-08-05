export { AI_CONFIG } from "./config";
export type { AIProvider, AITaskConfig } from "./config";
export { complete } from "./provider";
// Provider pool + resilience (patch-22)
export {
  getActiveProvider,
  getActiveModel,
  consumeUsage,
  wasTruncated,
  withAiContext,
  withTruncationReport,
  isInteractive,
} from "./provider/provider-context";
export type { TokenUsage } from "./provider/provider-context";
export { AIUnavailableError, checkGlobalBreaker } from "./provider/circuit-breaker";
export { loadProviders, checkProviderModels } from "./provider/provider-pool";
export type { Provider, ProviderCheck } from "./provider/provider-pool";
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
  PostHocGrounding,
  SelfCheckResult,
  SelfCheckTrigger,
  WithQuality,
} from "./grounding/types";
// Deterministic post-hoc grounding + abstention (Véracité Intelligence v2 P3)
export {
  extractVerifiableTokens,
  verifyAgainstSource,
  verifyFieldsAgainstSource,
} from "./grounding/posthoc-grounding";
export type { VerifiableToken, VerifiableTokens } from "./grounding/posthoc-grounding";
export { abstainFromUnverified, deterministicInsight } from "./grounding/abstention";
export type { AbstentionResult, InsightProse } from "./grounding/abstention";
export {
  classifyChange,
  ClassificationSchema,
  ModelClassificationSchema,
  resolveClassification,
  toMaterialityScores,
} from "./tasks/classify";
export type { Classification } from "./tasks/classify";
// Corroboration surfaces: built by the worker, read by both classifiers, so the
// shape and the prompt sentence that describes it live in one module.
export { formatCorroborationSurface, buildRecentSignalsBlock } from "./tasks/classify-shared";
export type { CorroborationSurface } from "./tasks/classify-shared";
// Materiality → severity: the deterministic table that replaced the model's own
// severity judgement.
export {
  MaterialitySchema,
  severityFromMateriality,
  explainMateriality,
  isSignificantFromMateriality,
  applyCategoryFloor,
  resolveSeverity,
} from "./tasks/materiality";
export type { Materiality, MaterialityScores } from "./tasks/materiality";
// Semantic gate — drops pure rewrites before they reach the classifier.
export {
  isSubstantiveChange,
  gateAppliesTo,
  suppressesAsCosmetic,
} from "./tasks/cosmetic-gate";
export type { CosmeticGateResult } from "./tasks/cosmetic-gate";
// Claim-level faithfulness: the publication gate for the high-stakes outputs
// (battle cards, digests, critical/high signal insights). Built ON the existing
// fuzzy citation validator, called one claim at a time.
export { verifyFaithfulness } from "./faithfulness/verify";
export type { VerifyFaithfulnessParams, FaithfulnessDeps } from "./faithfulness/verify";
export { decideGate, faithfulnessMinRatio, faithfulnessGateEnabled } from "./faithfulness/gate";
export { isClaimSupported, scoreClaims, verbatimRatio } from "./faithfulness/score-claims";
export { extractClaims } from "./faithfulness/extract-claims";
export { judgeClaim, JudgeSchema, buildJudgePrompt } from "./faithfulness/judge-claim";
export type {
  Claim,
  ClaimStatus,
  ClaimVerdict,
  FaithfulnessReport,
  FaithfulnessVerdict,
} from "./faithfulness/types";
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
export {
  judgeStandingQuery,
  buildStandingQueryJudgePrompt,
  StandingQueryJudgeSchema,
} from "./tasks/standing-query-judge";
export type {
  StandingQueryJudgement,
  StandingQueryJudgeInput,
} from "./tasks/standing-query-judge";
export { generateRepositioningInsight } from "./tasks/pricing-repositioning";
export type { RepositioningInput } from "./tasks/pricing-repositioning";
export {
  generateDigest,
  digestSourceText,
  DigestSchema,
  // The API reads the cap so the "in progress" view can report the moves that will
  // fall outside Monday's brief instead of promising a week the email won't carry.
  capDigestSignals,
  DIGEST_MAX_SIGNALS,
} from "./tasks/digest";
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
export { nameKnownCompetitors } from "./tasks/name-competitors";
export type { NamedCompetitor } from "./tasks/name-competitors";
export { extractPricing, PricingSchema, PricingPlanSchema, CreditBurnSchema } from "./tasks/extract-pricing";
export type { PricingExtraction, PricingPlan } from "./tasks/extract-pricing";
export { extractEntitlements, EntitlementsSchema } from "./tasks/extract-entitlements";
export type { EntitlementsExtraction, ExtractedEntitlement } from "./tasks/extract-entitlements";
export { extractJobs, JobsSchema, JobPostingSchema } from "./tasks/extract-jobs";
export type { JobsExtraction, ExtractedJob } from "./tasks/extract-jobs";
// Job-description fact mining (Hiring Intelligence v2 P1). The model PROPOSES;
// the deterministic guards in @outrival/scrapers/jobs-jd-facts decide.
export { mineJobFacts, JobFactsSchema, MinedFactSchema } from "./tasks/mine-job-facts";
export type {
  JobFactsExtraction,
  MinedFactRaw,
  JobDescriptionInput,
} from "./tasks/mine-job-facts";
// Changelog entry typing (Content Intelligence v2 P1). The model only ever
// separates feature / improvement / fix — the alerting types are decided by the
// keyword pass in @outrival/scrapers/content before this is ever called.
export {
  typeContentItems,
  TypedContentItemsSchema,
  TypedContentItemSchema,
  TYPEABLE_ITEM_TYPES,
} from "./tasks/type-content-items";
export type {
  TypedContentItems,
  TypedContentItem,
  ContentItemForTyping,
} from "./tasks/type-content-items";
// Content Intelligence v2 P2 — batched blog-post reading. Every competitor it
// names is re-checked against the post text in code before it can reach a signal.
export {
  enrichBlogPosts,
  EnrichedBlogPostsSchema,
  EnrichedBlogPostSchema,
  BlogMentionSchema,
  BLOG_POST_TYPES,
} from "./tasks/enrich-blog-posts";
export type {
  EnrichedBlogPosts,
  EnrichedBlogPost,
  BlogPostForEnrichment,
} from "./tasks/enrich-blog-posts";
// Content Intelligence v2 P3 — batched case-study reading. The customer name and
// every claimed metric are re-checked against the page text in code before either
// can reach the registry or a signal.
export {
  extractCaseStudies,
  ExtractedCaseStudiesSchema,
  ExtractedCaseStudySchema,
} from "./tasks/extract-case-studies";
export type {
  ExtractedCaseStudies,
  ExtractedCaseStudy,
  CaseStudyForExtraction,
} from "./tasks/extract-case-studies";
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
// P4 — heal step for calculator probing: locates the quantity control and the
// total (selectors only; every amount is still read by code).
export { generateCalculatorSpec } from "./tasks/generate-calculator-spec";
export { generateCompetitorSummary, SummarySchema } from "./tasks/competitor-summary";
export type { CompetitorSummary, CompetitorSummaryInput } from "./tasks/competitor-summary";
export { summarizeSource, SourceSummarySchema } from "./tasks/summarize-source";
export type { SourceSummary, SourceSummaryInput } from "./tasks/summarize-source";
export {
  generateBattleCard,
  reviseBattleCard,
  battleCardEvidence,
  BattleCardSchema,
} from "./tasks/battle-card";
export type { BattleCardContent, BattleCardInput } from "./tasks/battle-card";
export { parsePartialCard } from "./tasks/battle-card-partial";
export type { PartialBattleCard, PartialCardRead } from "./tasks/battle-card-partial";
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
export {
  generateVisibilityPrompts,
  fallbackVisibilityPrompts,
} from "./tasks/generate-visibility-prompts";
export type { VisibilityPromptInput } from "./tasks/generate-visibility-prompts";
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
