import type {
  BillingPeriod,
  Plan,
  SourceType,
  MonitorFrequency,
  DetectionConfig,
} from "@outrival/shared";

export type { DetectionConfig } from "@outrival/shared";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type ApiErrorCode =
  | "plan_limit_competitors"
  | "plan_locked_feature"
  | "plan_locked_source"
  | "plan_locked_frequency"
  | "plan_locked_channel";

export class ApiError extends Error {
  status: number;
  code?: ApiErrorCode | string;
  data: Record<string, unknown>;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    this.data = data;
    if (typeof data.error === "string") this.code = data.error;
  }
}

async function throwApiError(res: Response): Promise<never> {
  const text = await res.text().catch(() => "");
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not json, leave as text
  }
  throw new ApiError(res.status, body, `API ${res.status}: ${text || res.statusText}`);
}

// Browser-side ceiling. Sits above the API's own request bound so a slow
// endpoint resolves server-side (gracefully empty) before the browser aborts —
// this only fires when the API itself is unreachable, turning the opaque
// "TypeError: Failed to fetch" into a clear, actionable error.
const REQUEST_TIMEOUT_MS = 20_000;

// Wraps fetch so a timeout or network drop surfaces as a typed ApiError instead
// of a bare TypeError that callers stringify into "TypeError: Failed to fetch".
async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    throw new ApiError(
      0,
      { error: timedOut ? "timeout" : "network_error" },
      timedOut
        ? "Request timed out — the server took too long to respond. Try again."
        : "Network error — could not reach the API. Check your connection and retry.",
    );
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await safeFetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...init,
  });
  if (!res.ok) await throwApiError(res);
  return res.json() as Promise<T>;
}

// Multipart POST — never set Content-Type, the browser adds the boundary.
async function postForm<T>(path: string, form: FormData): Promise<T> {
  const res = await safeFetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: form,
  });
  if (!res.ok) await throwApiError(res);
  return res.json() as Promise<T>;
}

export interface CompetitorStats {
  signals7d: number;
  signalsPrev: number;
  lastSignalAt: string | null;
  categoryCounts: Record<string, number>;
}

export type PricingStatus =
  | "public"
  | "public_partial"
  | "gated_demo"
  | "gated_signup"
  | "dynamic"
  | "unknown";

export interface Competitor {
  id: string;
  name: string;
  url: string;
  description: string | null;
  category: string | null;
  overlapScore: number | null;
  aiSummary: string | null;
  aiSummaryUpdatedAt: string | null;
  metadata: Record<string, unknown> | null;
  // Pricing taxonomy (patch-11)
  pricingStatus: PricingStatus | null;
  pricingObservedRegion: string | null;
  pricingPromotional: boolean;
  pricingDemoUrl: string | null;
  pricingNote: string | null;
  pricingManualOverride: boolean;
  // Kebab actions (Pause monitoring / Mute alerts). Paused = scheduler skips every
  // source; muted = signals still tracked but no immediate alert.
  monitoringPaused: boolean;
  alertsMuted: boolean;
  createdAt: string;
  updatedAt: string;
  stats?: CompetitorStats;
  // Aggregate freshness for the global list dot (patch-14): the stalest active
  // source's last scrape + whether any source's last scan failed.
  freshness?: { lastScrapedAt: string | null; status: "success" | "failed" };
}

export interface CompetitorJob {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  isActive: boolean;
  detectedAt: string;
  // patch-32 hiring enrichment — populated on the structured ATS path, null on the
  // LLM/careers fallback. seniority is a canonical bucket; salary is normalized.
  url: string | null;
  seniority: string | null;
  postedAt: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}

export interface JobsByDepartment {
  total: number;
  departments: Array<{
    department: string;
    count: number;
    jobs: CompetitorJob[];
  }>;
}

export interface JobTrendPoint {
  department: string;
  count: number;
  recorded_at: string;
}

export interface PricingHistoryPoint {
  plan_name: string;
  price: number;
  currency: string;
  billing_period: string;
  recorded_at: string;
}

export interface ReviewScorePoint {
  source: string;
  score: number;
  review_count: number;
  sentiment_score: number;
  recorded_at: string;
}

export interface ReviewVerbatim {
  id: string;
  source: string;
  score: number | null;
  content: string | null;
  author: string | null;
  detectedAt: string;
}

export interface ReviewSubScores {
  easeOfUse: number | null;
  support: number | null;
  features: number | null;
  value: number | null;
}

export interface ReviewComplaintTheme {
  theme: string;
  prevalence: string;
}

export interface ReviewsData {
  summary: {
    praises: Array<string | null>;
    complaints: Array<string | null>;
    lastUpdatedAt: string | null;
    // patch-32 per-criterion ratings (/5) from the latest scrape that carried a
    // breakdown; null when no source exposes one.
    subScores: ReviewSubScores | null;
    // gap-B recurring complaint themes (clustered, with prevalence) — a repeated
    // grievance is a competitive opening. Empty when none.
    complaintThemes: ReviewComplaintTheme[];
  };
  recent: ReviewVerbatim[];
}

export interface CompetitorSignal {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  insight: string;
  soWhat: string | null;
  recommendedAction: string | null;
  isRead: boolean;
  createdAt: string;
  changeId?: string | null;
  sourceType: string | null;
  monitorUrl: string | null;
}

export interface Monitor {
  id: string;
  competitorId: string;
  sourceType: SourceType;
  frequency: string;
  config: { url?: string } | null;
  lastRunAt: string | null;
  lastChangedAt: string | null;
  scrapeStartedAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  aiSummary: string | null;
  aiSummaryUpdatedAt: string | null;
  // patch-23 — surfaced so the UI can show alternatives for an unscrapable source.
  isActive?: boolean;
  markedUnscrapable?: boolean;
  lastFailureCategory?: string | null;
  apiCaptureEnabled?: boolean;
}

export interface ChangeRow {
  id: string;
  diffText: string | null;
  summary: string | null;
  detectedAt: string;
  monitorId: string;
  sourceType: string;
  monitorUrl?: string | null;
  competitorId?: string;
  competitorName?: string;
  competitorUrl?: string;
}

// Intel → action loop (Phase B). User-set triage status on a signal.
export type ActionStatus = "todo" | "doing" | "done" | "dismissed";

export interface Signal {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  // User severity override (patch-21); prefer it over `severity` for display.
  severityOverride: "low" | "medium" | "high" | "critical" | null;
  category: string;
  insight: string;
  soWhat: string | null;
  recommendedAction: string | null;
  // Strategic narrative for significant structured homepage changes (patch-16);
  // null otherwise → the card shows just the insight title.
  narrative: string | null;
  isRead: boolean;
  // Intel → action loop (Phase B): the user's triage status + note; null = untriaged.
  actionStatus: ActionStatus | null;
  actionNote: string | null;
  createdAt: string;
  competitorId: string;
  competitorName: string;
  changeId: string;
  sourceType: string | null;
  // The current user's quality verdict on this signal (patch-21), preloaded so
  // the inline feedback buttons render in the right state. null = no verdict yet.
  feedbackVerdict: "useful" | "not_useful" | "neutral" | null;
  // AI self-confidence + self-check flag (patch-24). aiConfidence drives the
  // ConfidenceDot (hidden when "high"); aiFlagged shows the "couldn't be verified"
  // warning. Both null when the signal predates grounding.
  aiConfidence: "low" | "medium" | "high" | null;
  aiFlagged: boolean | null;
  aiQualityCheckId: string | null;
  // P0 threat weighting: how much this competitor overlaps with us (0-100, nullable)
  // and the server-computed threat score (0-1) the feed is ordered by.
  overlapScore: number | null;
  relevanceScore: number | null;
  threatScore: number;
  // patch-26 batching: when several similar signals were grouped, the feed
  // collapses them into one card with the batch summary. Null for un-batched.
  batchedIntoId: string | null;
  batchSummary: string | null;
  batchCount: number | null;
  // patch-26 moderation transparency: why this signal wasn't sent as an immediate
  // alert (below_threshold | channel_muted | quiet_hours | frequency_cap). Null =
  // not held back.
  filteredReason: string | null;
}

// User-safe "Why this insight?" payload (patch-14). No raw HTML, no diff, no AI
// classification — only what the user can read and act on.
// One typed semantic change in the structured homepage breakdown (patch-16).
export interface SignalChange {
  kind: string;
  field: string;
  before: string | null;
  after: string | null;
  significance: string | null;
  // patch-17 extras: claim variation, hamming distance, relevance score, etc.
  metadata: Record<string, unknown> | null;
}

export interface SignalDetail {
  id: string;
  insight: string;
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  detectedAt: string;
  humanChangeBefore: string | null;
  humanChangeAfter: string | null;
  // Strategic narrative + per-change breakdown for structured homepage changes
  // (patch-16). narrative is null and changes is empty for lexical / pre-patch signals.
  narrative: string | null;
  changes: SignalChange[];
  // Composite relevance score (patch-17), max across the change set. null when
  // not scored (lexical / pre-patch). Shown discreetly.
  relevanceScore: number | null;
  sourceType: string | null;
  sourceUrl: string | null;
  competitor: { id: string; name: string };
}

// Meso-level sector trend across the org's own competitors (patch-13). Distinct
// from the micro `Signal`. `confidence` arrives as a numeric string ("0.78").
export type SectoralCategory =
  | "feature_trend"
  | "hiring_trend"
  | "pricing_trend"
  | "positioning_shift"
  | "category_emergence";

export interface SectoralEvidence {
  competitors: Array<{ id: string; name: string }>;
  dataPoints: unknown[];
  metric: string;
  value: number | string;
}

export interface SectoralSignal {
  id: string;
  category: SectoralCategory;
  title: string;
  insight: string;
  evidence: SectoralEvidence;
  confidence: string;
  periodStart: string;
  periodEnd: string;
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

// Activity — user-facing view of the scraping work done for the org.
export type ActivitySourceStatus = "ok" | "failing" | "paused" | "unscrapable";

export interface ActivitySource {
  monitorId: string;
  competitorId: string;
  competitorName: string;
  sourceType: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  status: ActivitySourceStatus;
}

// One readable change in the expandable activity detail: a typed label + a
// before/after. Shaped server-side from changes.structured_diff (homepage).
export interface ActivityChange {
  kind: string;
  field: string;
  before: string | null;
  after: string | null;
}

export interface ActivityEvent {
  competitorId: string;
  competitorName: string;
  sourceType: string;
  status: "success" | "no_change" | "failed";
  durationMs: number;
  recordedAt: string;
  // What the "Change detected" run actually found (null for no-change/failed runs
  // or when the diff isn't text, e.g. structured homepage changes).
  changeId?: string | null;
  changeSummary?: string | null;
  // Precise, readable breakdown shown when a run row is expanded. Typed homepage
  // changes (before→after per region) + the AI-distilled plain before/after off
  // the signal (any source). Empty/null when the run produced no signal/structure.
  structuredChanges?: ActivityChange[];
  humanChangeBefore?: string | null;
  humanChangeAfter?: string | null;
  // True only for a monitor's baseline capture (first snapshot, no diff possible).
  // Distinguishes the first scrape from an actual "change detected" in the feed.
  isFirstCapture?: boolean;
}

// The user-facing outcome buckets used to filter the activity feed — derived from
// the raw run status + whether a change row / earlier snapshot exists (see the
// /api/activity/timeline route). Not the same as ActivityEvent.status (raw run).
export type ActivityStatusFilter = "change" | "first_capture" | "no_change" | "failed";

// Consumption cockpit (Phase A) — quantified per-tier caps with current use.
export type UsageDimension =
  | "competitors"
  | "products"
  | "battleCardsPerDay"
  | "discoveriesPerMonth"
  | "forcedRescansPerDay";

export interface UsageItem {
  dimension: UsageDimension;
  used: number;
  limit: number;
  period: "current" | "day" | "month";
  suggestedPlan: Plan | null;
}

export interface UsageSnapshot {
  plan: Plan;
  items: UsageItem[];
}

// Consumption cockpit (Phase A) — cross-competitor trend leaderboards + drill series.
export interface PricingMove {
  competitorId: string;
  competitorName: string;
  planName: string;
  price: number;
  prevPrice: number | null;
  currency: string;
  billingPeriod: string;
  recordedAt: string;
}
export interface HiringMove {
  competitorId: string;
  competitorName: string;
  latest: number;
  earliest: number;
  net: number;
}
export interface ReviewMove {
  competitorId: string;
  competitorName: string;
  source: string;
  score: number;
  reviewCount: number;
  recordedAt: string;
}
export interface TechMove {
  competitorId: string;
  competitorName: string;
  techId: string;
  event: string;
  importance: string;
  recordedAt: string;
}
export interface TrendsSummary {
  window: number;
  pricing: PricingMove[];
  hiring: HiringMove[];
  reviews: ReviewMove[];
  tech: TechMove[];
  // True when a sub-query failed (vs. genuinely no data) so the UI can show a
  // "temporarily unavailable" state instead of an empty one. Optional for back-compat.
  degraded?: boolean;
}
export type TrendMetric = "pricing" | "hiring" | "reviews";
export interface TrendSeriesPoint {
  t: string;
  key: string;
  value: number;
}
export interface TrendsSeries {
  metric: TrendMetric;
  competitorId: string;
  points: TrendSeriesPoint[];
}

// Consumption cockpit (Phase A) — N-way comparison matrix column.
export interface CompareColumn {
  id: string;
  name: string;
  url: string | null;
  positioning: { category: string | null; summary: string | null };
  pricing: {
    entry: number;
    top: number;
    currency: string | null;
    billingPeriod: string | null;
    plans: Array<{ name: string; price: number; billingPeriod: string | null }>;
  } | null;
  hiring: {
    totalOpen: number;
    topDepartment: string | null;
    departments: Array<{ department: string; count: number }>;
  } | null;
  reviews: Array<{
    source: string;
    score: number;
    reviewCount: number;
    sub: { ease: number; support: number; features: number; value: number } | null;
  }>;
  tech: string[];
  platform: {
    framework: string | null;
    cms: string | null;
    ats: string | null;
    hosting: string | null;
  } | null;
  latestSignal: { severity: string; createdAt: string } | null;
}

// Activation checklist (Phase B) — booleans derived from existing data.
export type ChecklistStepKey =
  | "product"
  | "competitor"
  | "monitoring"
  | "notifications"
  | "signal";
export interface ChecklistStep {
  key: ChecklistStepKey;
  done: boolean;
}
export interface OnboardingChecklist {
  steps: ChecklistStep[];
  complete: boolean;
}

// Saved Signals-feed filter sets (Phase B).
export interface SavedViewFilters {
  competitorIds?: string[];
  categories?: string[];
  severities?: string[];
  view?: string;
}
export interface SavedView {
  id: string;
  name: string;
  filters: SavedViewFilters;
  createdAt: string;
}

// Outbound webhook destinations (Phase C). Secrets are never returned — only `hasSecret`.
export interface CrmDestination {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  hasSecret: boolean;
  lastPushedAt: string | null;
  createdAt: string;
}

// Signal comments (Phase C). `mine` flags the caller's own comments.
export interface SignalComment {
  id: string;
  userId: string;
  authorName: string;
  body: string;
  createdAt: string;
  mine: boolean;
}

export interface DigestSection {
  urgency: "action_required" | "watch" | "fyi";
  competitor: string;
  category: string;
  insight: string;
  so_what: string;
}

export interface DigestContent {
  temperature: "low" | "moderate" | "high";
  tldr: string[];
  sections: DigestSection[];
}

export type DigestRange = "this_week" | "last_7_days" | "last_30_days";

export interface Digest {
  id: string;
  orgId: string;
  weekStart: string;
  weekEnd: string;
  content: DigestContent;
  temperature: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface NotificationSettings {
  slackWebhookUrl: string | null;
  webhookUrl: string | null;
  digestEmail: string | null;
  digestEnabled: boolean;
  alertsEnabled: boolean;
}

// Notification moderation (patch-26) — org-scoped.
export type ChannelMode =
  | "email_immediate"
  | "digest_daily"
  | "digest_weekly"
  | "in_app_only"
  | "muted";

export interface NotificationPreferences {
  channelCritical: ChannelMode;
  channelHigh: ChannelMode;
  channelMedium: ChannelMode;
  channelLow: ChannelMode;
  timezone: string;
  timezoneDetectedAt: string | null;
  quietHoursStart: number;
  quietHoursEnd: number;
  weekendOff: boolean;
  dailyEmailCap: number;
  batchingEnabled: boolean;
}

export interface RelevanceThresholdInfo {
  threshold: number;
  source: "default" | "auto_adjusted" | "user_set";
  feedbackCountAtCalc: number;
  lastRecalculatedAt: string | null;
}

export interface WorkspaceSettings {
  name: string;
  slug: string;
  productUrl: string | null;
  productProfile: ProductProfile | null;
  projectStage: ProjectStage | null;
}

export interface ProductProfile {
  category: string;
  audience: string;
  valueProp: string;
  pricingModel: string;
}

export type ProjectStage = "idea" | "document" | "developing" | "live";
export type OnboardingStep =
  | "stage"
  | "input"
  | "profile"
  | "discover"
  | "monitoring"
  | "done";

export interface OnboardingStatus {
  onboardingCompleted: boolean;
  onboardingSkipped: boolean;
  onboardingStep: OnboardingStep | null;
  projectStage: ProjectStage | null;
  productUrl: string | null;
  profile: ProductProfile | null;
  plan: Plan;
}

export interface DiscoveredCompetitor {
  url: string;
  title: string;
  snippet: string;
  overlapScore: number;
  reason: string;
}

// Patch-25: resumable onboarding attempt + step-timing store.
export type OnboardingSessionStage =
  | "started"
  | "input"
  | "profile"
  | "discover"
  | "monitoring"
  | "analysis_in_progress"
  | "completed"
  | "abandoned";
export type OnboardingMode = "quick_start" | "full";

export interface OnboardingSession {
  id: string;
  userId: string;
  orgId: string | null;
  stage: OnboardingSessionStage;
  mode: OnboardingMode;
  productUrl: string | null;
  productProfile: ProductProfile | null;
  discoverySuggestions: DiscoveredCompetitor[] | null;
  addedCompetitorIds: string[] | null;
  timings: Record<string, number>;
  startedAt: string;
  lastActivityAt: string;
  completedAt: string | null;
}

export interface OnboardingSessionPatch {
  stage?: OnboardingSessionStage;
  mode?: OnboardingMode;
  productUrl?: string | null;
  productProfile?: ProductProfile;
  discoverySuggestions?: DiscoveredCompetitor[];
  addedCompetitorIds?: string[];
  timings?: Record<string, number>;
}

export interface BattleCardContent {
  their_strengths: string[];
  our_strengths: string[];
  their_weaknesses: string[];
  common_objections: Array<{ objection: string; response: string }>;
  when_we_win: string[];
  when_we_lose: string[];
}

export interface BattleCard {
  id: string;
  competitorId: string;
  orgId: string;
  content: BattleCardContent;
  pdfR2Key: string | null;
  generatedAt: string;
  updatedAt: string;
}

// patch-29 — org-wide battle card list item for /dashboard/battle-cards and the
// overview "recent" section. productName is null for legacy cards with no product.
export interface BattleCardSummary {
  id: string;
  competitorId: string;
  competitorName: string;
  productId: string | null;
  productName: string | null;
  hasPdf: boolean;
  generatedAt: string;
  updatedAt: string;
}

export interface CompetitorCandidate {
  id: string;
  orgId: string;
  url: string;
  title: string | null;
  overlapScore: number | null;
  reason: string | null;
  status: "new" | "dismissed" | "added";
  source: "detection" | "onboarding";
  firstSeenAt: string;
}

export interface BillingInfo {
  plan: Plan;
  planPeriod: BillingPeriod | null;
  hasSubscription: boolean;
  usage: {
    competitors: { used: number; limit: number | null };
  };
  features: {
    battleCards: boolean;
    realtimeAlerts: boolean;
    api: boolean;
    multiUser: boolean;
  };
}

export interface SearchCompetitorHit {
  id: string;
  name: string;
  url: string;
  category: string | null;
}

export interface SearchSignalHit {
  id: string;
  competitorId: string;
  competitorName: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  insight: string;
  createdAt: string;
}

export interface SearchDigestHit {
  id: string;
  weekStart: string;
  weekEnd: string;
  temperature: string | null;
}

export interface SearchResults {
  competitors: SearchCompetitorHit[];
  signals: SearchSignalHit[];
  digests: SearchDigestHit[];
}

export interface SelfProfileField<T> {
  value: T;
  isFromAutoDetect: boolean;
  lastEditedByUserAt: string | null;
}

export interface SelfProfile {
  category?: SelfProfileField<string>;
  audience?: SelfProfileField<string>;
  valueProp?: SelfProfileField<string>;
  features?: SelfProfileField<string[]>;
  techStack?: SelfProfileField<string[]>;
}

export interface MyProductPricingTier {
  plan_name: string;
  price: number;
  currency: string;
  billing_period: string;
}

export interface MyProductJob {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  url: string | null;
}

export interface MyProduct {
  id: string;
  name: string;
  url: string | null;
  repoUrl: string | null;
  lastScanAt: string | null;
  // True while at least one self monitor is mid-scrape; scanError carries the
  // last failure message once scanning settles.
  scanning: boolean;
  scanError: string | null;
  aiSummary: string | null;
  profile: SelfProfile;
  pricing: {
    status: string | null;
    observedRegion: string | null;
    promotional: boolean;
    demoUrl: string | null;
    note: string | null;
    manualOverride: boolean;
    tiers: MyProductPricingTier[];
    // tiers were entered by the user (vs auto-detected from scraping).
    tiersManual: boolean;
    tiersEditedAt: string | null;
  };
  jobs: { total: number; items: MyProductJob[] };
}

export type SelfChangeStatus = "pending" | "accepted" | "modified" | "ignored";
export type SelfChangeSeverity = "minor" | "major";

export interface SelfProductChange {
  id: string;
  // Originating pipeline change; null = a profile-divergence proposal (editable).
  changeId: string | null;
  fieldPath: string;
  previousValue: unknown;
  newValue: unknown;
  summary: string | null;
  severity: SelfChangeSeverity;
  status: SelfChangeStatus;
  detectedAt: string;
  resolvedAt: string | null;
}

// Selective re-scan targets, one per My Product card. profile/features/techStack
// all map to the homepage scrape server-side (deduped); pricing to the pricing monitor.
export type MyProductRescanCategory = "profile" | "pricing" | "features" | "techStack";

export interface MyProductPatch {
  category?: string;
  audience?: string;
  valueProp?: string;
  features?: string[];
  techStack?: string[];
  pricing?: {
    status?: string;
    observedRegion?: string | null;
    promotional?: boolean;
    demoUrl?: string | null;
    note?: string | null;
    tiers?: MyProductPricingTier[];
  };
}

// --- Admin ops (patch-02). Mirrors /api/admin/* responses. ---
export type AdminOverview = {
  orgsByPlan: { plan: string; count: number }[];
  totalUsers: number;
  totalCompetitors: number;
  signals7d: number;
};

export type AdminSourceHealth = {
  sourceType: string;
  total: number;
  failed: number;
  failureRate: number;
  proxyRate: number;
  avgMs: number;
};

export type AdminDeadMonitor = {
  monitorId: string;
  competitorId: string;
  competitorName: string | null;
  sourceType: string;
  recentStatuses: string[];
};

export type AdminScrapingHealth = {
  window: string;
  sources: AdminSourceHealth[];
  // Patch-20 cascade-level distribution over the window (counts per level).
  levels: { l0: number; l1: number; l2: number; l3: number; l4: number };
  // Patch-30 staged-extraction resolution distribution over the window (counts).
  extraction: { structured: number; cache: number; heal: number; aiFallback: number };
  deadMonitors: AdminDeadMonitor[];
};

export type AdminTaskHealth = {
  task: string;
  total: number;
  parseFailed: number;
  parseFailedRate: number;
  errors: number;
  errorRate: number;
};

export type AdminAiProvider = {
  id: string;
  tier: "free" | "paid";
  priority: number;
  dailyTokenQuota: number;
  usedTokens: number;
  pct: number;
  breaker: string | null;
};

export type AdminAiHealth = {
  window: string;
  tasks: AdminTaskHealth[];
  signalsByDay: { day: string; count: number }[];
  providers: AdminAiProvider[];
  globalBreaker: { open: boolean; reason: string | null; resetInSec: number | null };
  prediction: {
    usagePct: number;
    totalUsed: number;
    totalCapacity: number;
    hoursToSaturation: number | null;
  };
};

export type AdminCost = {
  estimated: boolean;
  proxy: {
    scrapes24h: number;
    scrapes30d: number;
    fixedUsdPerMonth: number;
    estUsd24h: number;
    estUsd30d: number;
  };
  ai: { calls24h: number; calls30d: number; estUsd24h: number; estUsd30d: number };
  storage: {
    postgresBytes: number | null;
    r2Bytes: number | null;
  };
};

export type AdminPlatformDetection = {
  window: string;
  stages: { aStatic: number; bBrowser: number };
  avgMsByStage: { aStatic: number; bBrowser: number };
  connectors: {
    total: number;
    ats: number;
    statusPage: number;
    changelog: number;
    pricingWidget: number;
  };
  topFrameworks: { name: string; count: number }[];
  topCms: { name: string; count: number }[];
  topAts: { name: string; count: number }[];
};

export type AdminDelivery = {
  alerts: {
    windowDays: number;
    byChannel: {
      channel: string;
      total: number;
      sent: number;
      failed: number;
      failRate: number;
    }[];
    recentFailures: {
      id: string;
      channel: string;
      error: string | null;
      orgName: string | null;
      createdAt: string | null;
    }[];
  };
  digests: {
    windowDays: number;
    generated: number;
    sent: number;
    unsent: number;
    temperature: { low: number; moderate: number; high: number; unknown: number };
  };
};

export type AdminDiscovery = {
  windowDays: number;
  candidates: {
    total: number;
    new: number;
    added: number;
    dismissed: number;
    acceptanceRate: number;
    avgOverlap: number;
  };
  bySource: {
    source: string;
    total: number;
    added: number;
    dismissed: number;
    acceptanceRate: number;
  }[];
  discovery: { month: string; detectThisMonth: number; activeOrgs: number };
  recent: {
    url: string;
    title: string | null;
    overlapScore: number | null;
    status: string;
    source: string;
    firstSeenAt: string | null;
  }[];
};

export type AdminOnboardingMetrics = {
  windowDays: number;
  total: number;
  byStatus: { completed: number; abandoned: number; inProgress: number; other: number };
  modeSplit: { quick_start: number; full: number };
  segments: Array<{
    key: string;
    label: string;
    count: number;
    medianMs: number | null;
    p90Ms: number | null;
    p95Ms: number | null;
  }>;
  funnel: Array<{ key: string; label: string; reached: number; dropoffPct: number | null }>;
};

export type AdminUserRow = {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
  orgId: string | null;
  orgName: string | null;
  plan: string | null;
};

export type AdminMonitorRow = {
  id: string;
  competitorId: string;
  sourceType: string;
  isActive: boolean;
  requiresLevel: number | null;
  markedUnscrapable: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastChangedAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
};

export type AdminUserDetail = {
  user: { id: string; email: string; name: string | null; role: string; createdAt: string };
  org: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    planPeriod: string | null;
  } | null;
  competitors: {
    id: string;
    name: string;
    url: string | null;
    type: string;
    monitors: AdminMonitorRow[];
  }[];
};

export type AdminFeedbackStatus = "new" | "reviewed" | "resolved";

export type AdminFeedbackRow = {
  id: string;
  type: "bug" | "idea" | "other";
  message: string;
  pageUrl: string | null;
  consoleErrors: { ts: number; message: string }[] | null;
  screenshotR2Key: string | null;
  userAgent: string | null;
  status: AdminFeedbackStatus;
  createdAt: string;
  orgId: string | null;
  userEmail: string | null;
};

export type AdminAuditEntry = {
  id: string;
  actorEmail: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type AdminJobRun = {
  id: string;
  taskIdentifier: string;
  status: string;
  isTest: boolean;
  version: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  costInCents: number | null;
};

export type AdminJobDetail = AdminJobRun & {
  attemptCount: number | null;
  error: string | null;
  payload: unknown;
};

// Detected tech stack on a competitor (patch-18).
export type TechStackEntry = {
  techId: string;
  name: string;
  category: string;
  importance: "high" | "medium" | "low";
  firstDetectedAt: string;
  lastDetectedAt: string;
};

// Auto-detected platform profile (patch-31). Each field carries the detected
// value + how it was proven; absent fields were not detected.
export type PlatformField = {
  value: string;
  confidence: "low" | "medium" | "high";
  evidence: string[];
};

export type PlatformProfile = {
  framework?: PlatformField;
  cms?: PlatformField;
  ats?: PlatformField;
  pricingWidget?: PlatformField;
  statusPage?: PlatformField;
  changelog?: PlatformField;
  analytics?: PlatformField[];
  detectedAt: string;
  v: number;
};

export type TechStackData = {
  entries: TechStackEntry[];
  lastScrapedAt: string | null;
  platformProfile: PlatformProfile | null;
};

// Competitor "fact sheet" — the state view behind the Overview tab. Pure
// surfacing of already-captured data (homepage structure patch-16/17, pricing /
// reviews analytics, active job postings); no AI generation. Any field can be
// empty/null when that source was never captured or analytics are unavailable.
export type CompetitorOverview = {
  // When the homepage facts below were captured (last homepage snapshot). null
  // when no homepage snapshot carries a parsed structure yet.
  capturedAt: string | null;
  homepage: {
    headline: string | null;
    subheadline: string | null;
    valueProps: string[];
    customerLogos: Array<{ name: string | null; src: string | null }>;
    testimonials: Array<{ quote: string; author: string | null }>;
  } | null;
  numericClaims: Array<{
    pattern: string;
    value: number | null;
    unit: string | null;
    raw_text: string;
  }>;
  pricingNow: Array<{
    plan_name: string;
    price: number;
    currency: string;
    billing_period: string;
  }>;
  reviews: Array<{
    source: string;
    score: number;
    review_count: number;
    sentiment_score: number;
  }>;
  hiring: { openRoles: number };
};

// --- Quality feedback on AI outputs (patch-21) ---
export type QualityFeedbackTargetType =
  | "signal"
  | "discovery_suggestion"
  | "battle_card"
  | "digest"
  | "severity_classification"
  | "nps";

export type QualityFeedbackVerdict = "useful" | "not_useful" | "neutral";

export type QualityFeedbackReason =
  | "irrelevant"
  | "incorrect"
  | "trivial"
  | "too_high_severity"
  | "too_low_severity"
  | "duplicate"
  | "outdated"
  | "other";

export interface QualityFeedbackInput {
  targetType: QualityFeedbackTargetType;
  targetId: string;
  verdict: QualityFeedbackVerdict;
  reason?: QualityFeedbackReason;
  freeText?: string;
  npsScore?: number;
  metadata?: Record<string, unknown>;
}

export interface QualityImmediateAction {
  type: string;
  description: string;
}

export interface QualityFeedbackRow {
  id: string;
  targetType: QualityFeedbackTargetType;
  targetId: string;
  verdict: QualityFeedbackVerdict;
  reason: QualityFeedbackReason | null;
  npsScore: number | null;
  createdAt: string;
}

// patch-28 — admin multi-product adoption metrics.
export interface AdminMultiProductMetrics {
  orgsWithProducts: number;
  multiProductOrgs: number;
  totalActiveProducts: number;
  distribution: {
    one: number;
    two: number;
    three: number;
    fourToFive: number;
    sixPlus: number;
  };
  associations: { shared: number; specific: number };
  battleCards: { total: number; couples: number; avgPerProduct: number };
}

// Enrichment completeness — how much of the structured enrichment actually lands.
export interface AdminEnrichmentCompleteness {
  hiring: { total: number; withSeniority: number; withSalary: number; viaAts: number };
  reviews: { withScores: number; withSubScores: number; withThemes: number };
  platform: { eligible: number; withProfile: number };
}

// patch-28 — a product (SKU) in the multi-product selector / settings.
export interface ProductSummary {
  id: string;
  name: string;
  isPrimary: boolean;
  status: "active" | "paused" | "archived";
  position: number;
  url: string | null;
  selfCompetitorId: string;
  competitorCount: number;
}

export const api = {
  search: (q: string) =>
    request<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`),
  listCompetitors: () => request<{ competitors: Competitor[] }>("/api/competitors"),
  getCompetitor: (id: string) =>
    request<{
      competitor: Competitor;
      monitors: Monitor[];
      recentChanges: ChangeRow[];
      recentSignals: CompetitorSignal[];
      techStack: TechStackData;
      overview: CompetitorOverview;
      plan: Plan;
    }>(`/api/competitors/${id}`),
  getCompetitorJobs: (id: string) =>
    request<JobsByDepartment>(`/api/competitors/${id}/jobs`),
  getCompetitorJobTrends: (id: string) =>
    request<{ trends: JobTrendPoint[] }>(`/api/competitors/${id}/job-trends`),
  getCompetitorReviews: (id: string) =>
    request<ReviewsData>(`/api/competitors/${id}/reviews`),
  getCompetitorReviewScores: (id: string) =>
    request<{ scores: ReviewScorePoint[] }>(`/api/competitors/${id}/review-scores`),
  getCompetitorPricingHistory: (id: string) =>
    request<{ history: PricingHistoryPoint[] }>(`/api/competitors/${id}/pricing-history`),
  // Whether AI generations are currently failing (rate limits) — drives the
  // "AI is catching up" dashboard banner. `since` keys the current incident.
  getAiStatus: () =>
    request<{
      status: "healthy" | "degraded" | "down";
      degraded: boolean;
      errorCount: number;
      since: string | null;
      estimatedRecovery: string | null;
    }>("/api/system/ai-status"),
  updateCompetitorPricing: (
    id: string,
    body: { status: PricingStatus; demoUrl?: string | null; note?: string | null },
  ) =>
    request<{ ok: true }>(`/api/competitors/${id}/pricing`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  redetectCompetitorPricing: (id: string) =>
    request<{ ok: true; rescraped: boolean }>(`/api/competitors/${id}/pricing/redetect`, {
      method: "POST",
    }),
  getCompetitorSignals: (id: string, limit = 50) =>
    request<{ signals: CompetitorSignal[] }>(`/api/competitors/${id}/signals?limit=${limit}`),
  createCompetitor: (body: { name: string; url: string; description?: string }) =>
    request<{ competitor: Competitor; monitors: Monitor[] }>("/api/competitors", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteCompetitor: (id: string) =>
    request<{ ok: true }>(`/api/competitors/${id}`, { method: "DELETE" }),
  // Kebab → Edit details. Any subset of name/url/category/description.
  updateCompetitor: (
    id: string,
    body: { name?: string; url?: string; category?: string | null; description?: string | null },
  ) =>
    request<{ competitor: Competitor }>(`/api/competitors/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  // Kebab → Pause / Resume monitoring.
  setCompetitorMonitoring: (id: string, paused: boolean) =>
    request<{ ok: true; paused: boolean }>(`/api/competitors/${id}/monitoring`, {
      method: "PATCH",
      body: JSON.stringify({ paused }),
    }),
  // Kebab → Mute / Unmute alerts.
  setCompetitorAlerts: (id: string, muted: boolean) =>
    request<{ ok: true; muted: boolean }>(`/api/competitors/${id}/alerts`, {
      method: "PATCH",
      body: JSON.stringify({ muted }),
    }),
  // Kebab → Recompute overlap (synchronous AI re-score against the product profile).
  recomputeCompetitorOverlap: (id: string) =>
    request<{ overlapScore: number | null; reason: string | null }>(
      `/api/competitors/${id}/recompute-overlap`,
      { method: "POST" },
    ),
  // Kebab → Assign to products: all org products + the subset this competitor links to.
  getCompetitorProducts: (id: string) =>
    request<{
      products: Array<{
        id: string;
        name: string;
        isPrimary: boolean;
        status: "active" | "paused" | "archived";
      }>;
      links: Array<{ productId: string; isSpecific: boolean }>;
    }>(`/api/competitors/${id}/products`),
  attachCompetitorToProduct: (productId: string, competitorId: string, isSpecific?: boolean) =>
    request<{ ok: true }>(`/api/products/${productId}/competitors/${competitorId}`, {
      method: "POST",
      body: JSON.stringify({ isSpecific: isSpecific ?? false }),
    }),
  detachCompetitorFromProduct: (productId: string, competitorId: string) =>
    request<{ ok: true }>(`/api/products/${productId}/competitors/${competitorId}`, {
      method: "DELETE",
    }),
  // Kebab → Export signals as CSV. Bypasses `request` (the body is text/csv, not
  // JSON); returns a Blob the caller turns into a download.
  exportCompetitorSignals: async (id: string): Promise<Blob> => {
    const res = await safeFetch(`${BASE}/api/competitors/${id}/export`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) await throwApiError(res);
    return res.blob();
  },
  refreshCompetitorSummary: (id: string) =>
    request<{ runId: string }>(`/api/competitors/${id}/refresh-summary`, {
      method: "POST",
    }),
  runMonitor: (id: string) =>
    request<{ runId: string; monitorId: string }>(`/api/monitors/${id}/run`, { method: "POST" }),
  // patch-27 — user-forced re-scan (per-tier daily limit; 429 → rescan_limit_reached).
  forceRescan: (id: string) =>
    request<{
      ok: true;
      runId: string;
      rescanLogId: string;
      monitorId: string;
      usageToday: number;
      dailyLimit: number;
    }>(`/api/monitors/${id}/force-rescan`, { method: "POST" }),
  forceRescanStatus: (logId: string) =>
    request<{ done: boolean; hadNewSignal: boolean | null; nextRunAt: string | null }>(
      `/api/monitors/force-rescan/${logId}/status`,
    ),
  // Dev-only: force a tech-stack scan (the /api/dev router is mounted only when
  // NODE_ENV !== "production"). Tech stack otherwise runs on its own monthly cron.
  scrapeTechStack: (id: string) =>
    request<{ runId: string }>(`/api/dev/competitors/${id}/scrape-tech-stack`, { method: "POST" }),
  updateMonitor: (id: string, patch: { url?: string; frequency?: MonitorFrequency }) =>
    request<{ monitor: Monitor }>(`/api/monitors/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteMonitor: (id: string) =>
    request<{ ok: true }>(`/api/monitors/${id}`, { method: "DELETE" }),
  addCompetitorMonitor: (
    id: string,
    sourceType: SourceType,
    opts?: { frequency?: MonitorFrequency; url?: string },
  ) =>
    request<{ monitor: Monitor; created: boolean }>(`/api/competitors/${id}/monitors`, {
      method: "POST",
      body: JSON.stringify({ sourceType, frequency: opts?.frequency, url: opts?.url }),
    }),
  classifyChange: (id: string) =>
    request<{ runId: string }>(`/api/changes/${id}/classify`, { method: "POST" }),
  listChanges: (params?: { limit?: number; competitorId?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.competitorId) q.set("competitorId", params.competitorId);
    const qs = q.toString();
    return request<{ changes: ChangeRow[] }>(`/api/changes${qs ? `?${qs}` : ""}`);
  },
  listSignals: (params?: {
    limit?: number;
    competitorId?: string;
    productId?: string;
    severity?: string;
    unreadOnly?: boolean;
    actionStatus?: string;
    // P0 — "threat" (default, server-side) | "recent" (chronological).
    sort?: "threat" | "recent";
  }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.competitorId) q.set("competitorId", params.competitorId);
    if (params?.productId) q.set("productId", params.productId);
    if (params?.severity) q.set("severity", params.severity);
    if (params?.unreadOnly) q.set("unreadOnly", "true");
    if (params?.actionStatus) q.set("actionStatus", params.actionStatus);
    if (params?.sort) q.set("sort", params.sort);
    const qs = q.toString();
    return request<{ signals: Signal[] }>(`/api/signals${qs ? `?${qs}` : ""}`);
  },
  markSignalRead: (id: string, read = true) =>
    request<{ ok: true }>(`/api/signals/${id}/read`, {
      method: "PATCH",
      body: JSON.stringify({ read }),
    }),
  setSignalAction: (id: string, status: ActionStatus | null, note?: string) =>
    request<{ ok: true }>(`/api/signals/${id}/action`, {
      method: "PATCH",
      body: JSON.stringify({ status, note }),
    }),
  getSignalDetail: (id: string) =>
    request<{ signal: SignalDetail }>(`/api/signals/${id}/detail`),
  listProducts: () =>
    request<{ products: ProductSummary[]; plan: string; limit: number }>(
      `/api/products`,
    ),
  createProduct: (body: { name: string; url?: string }) =>
    request<{ product: { id: string } }>(`/api/products`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateProduct: (
    id: string,
    body: { name?: string; position?: number; isPrimary?: true },
  ) =>
    request<{ product: ProductSummary }>(`/api/products/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  archiveProduct: (id: string) =>
    request<{ ok: true }>(`/api/products/${id}`, { method: "DELETE" }),
  listSectoral: (params?: {
    limit?: number;
    offset?: number;
    category?: SectoralCategory;
    dismissed?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    if (params?.category) q.set("category", params.category);
    if (params?.dismissed) q.set("dismissed", "1");
    const qs = q.toString();
    return request<{ signals: SectoralSignal[] }>(`/api/sectoral${qs ? `?${qs}` : ""}`);
  },
  markSectoralRead: (id: string) =>
    request<{ ok: true }>(`/api/sectoral/${id}/read`, { method: "POST" }),
  dismissSectoral: (id: string) =>
    request<{ ok: true }>(`/api/sectoral/${id}/dismiss`, { method: "POST" }),
  activityHealth: () =>
    request<{ sources: ActivitySource[] }>("/api/activity/health"),
  activityTimeline: (params?: {
    limit?: number;
    offset?: number;
    competitorId?: string;
    sourceType?: string;
    status?: ActivityStatusFilter;
  }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    if (params?.competitorId) q.set("competitorId", params.competitorId);
    if (params?.sourceType) q.set("sourceType", params.sourceType);
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return request<{ events: ActivityEvent[] }>(
      `/api/activity/timeline${qs ? `?${qs}` : ""}`,
    );
  },
  getUsage: () => request<UsageSnapshot>("/api/usage"),
  getTrendsSummary: (range?: { from: Date; to: Date }) => {
    const qs = range
      ? `?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`
      : "";
    return request<TrendsSummary>(`/api/trends/summary${qs}`);
  },
  getTrendsSeries: (
    competitorId: string,
    metric: TrendMetric,
    range?: { from: Date; to: Date },
  ) => {
    const base = `/api/trends/series?competitorId=${encodeURIComponent(competitorId)}&metric=${metric}`;
    const qs = range
      ? `&from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`
      : "";
    return request<TrendsSeries>(`${base}${qs}`);
  },
  compareCompetitors: (ids: string[]) =>
    request<{ competitors: CompareColumn[] }>(
      `/api/compare?competitorIds=${ids.map(encodeURIComponent).join(",")}`,
    ),
  getOnboardingChecklist: () =>
    request<OnboardingChecklist>("/api/onboarding/checklist"),
  listSavedViews: () => request<{ views: SavedView[] }>("/api/saved-views"),
  createSavedView: (name: string, filters: SavedViewFilters) =>
    request<{ view: SavedView }>("/api/saved-views", {
      method: "POST",
      body: JSON.stringify({ name, filters }),
    }),
  updateSavedView: (
    id: string,
    patch: { name?: string; filters?: SavedViewFilters },
  ) =>
    request<{ view: SavedView }>(`/api/saved-views/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteSavedView: (id: string) =>
    request<{ ok: true }>(`/api/saved-views/${id}`, { method: "DELETE" }),
  listCrmDestinations: () =>
    request<{ destinations: CrmDestination[] }>("/api/crm-destinations"),
  createCrmDestination: (name: string, url: string, secret?: string) =>
    request<{ destination: CrmDestination }>("/api/crm-destinations", {
      method: "POST",
      body: JSON.stringify({ name, url, secret }),
    }),
  updateCrmDestination: (
    id: string,
    patch: { name?: string; url?: string; secret?: string | null; enabled?: boolean },
  ) =>
    request<{ destination: CrmDestination }>(`/api/crm-destinations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteCrmDestination: (id: string) =>
    request<{ ok: true }>(`/api/crm-destinations/${id}`, { method: "DELETE" }),
  testCrmDestination: (id: string) =>
    request<{ ok: boolean }>(`/api/crm-destinations/${id}/test`, { method: "POST" }),
  listSignalComments: (id: string) =>
    request<{ comments: SignalComment[] }>(`/api/signals/${id}/comments`),
  addSignalComment: (id: string, body: string) =>
    request<{ comment: SignalComment }>(`/api/signals/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),
  deleteSignalComment: (id: string, commentId: string) =>
    request<{ ok: true }>(`/api/signals/${id}/comments/${commentId}`, { method: "DELETE" }),
  listDigests: () => request<{ digests: Digest[] }>("/api/digests"),
  getDigest: (id: string) => request<{ digest: Digest }>(`/api/digests/${id}`),
  generateDigest: (arg: DigestRange | { from: Date; to: Date } = "this_week") => {
    const body =
      typeof arg === "string"
        ? { range: arg }
        : { from: arg.from.toISOString(), to: arg.to.toISOString() };
    return request<{ digest: Digest | null; reason?: string }>("/api/digests/generate", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  getNotificationSettings: () =>
    request<NotificationSettings>("/api/settings/notifications"),
  updateNotificationSettings: (body: Partial<NotificationSettings>) =>
    request<{ ok: true }>("/api/settings/notifications", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  getNotificationPreferences: () =>
    request<{ preferences: NotificationPreferences }>("/api/notification-preferences"),
  updateNotificationPreferences: (
    body: Partial<NotificationPreferences>,
  ) =>
    request<{ preferences: NotificationPreferences }>("/api/notification-preferences", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  getRelevanceThreshold: () =>
    request<RelevanceThresholdInfo>("/api/notification-preferences/relevance-threshold"),
  sendTestAlert: () =>
    request<{
      results: Record<"email" | "slack" | "webhook", "sent" | "not_configured" | "error">;
      errors: Partial<Record<"email" | "slack" | "webhook", string>>;
    }>("/api/notifications/test", { method: "POST" }),
  setPassword: (body: { newPassword: string; currentPassword?: string }) =>
    request<{ ok: true; changed: boolean }>("/api/auth/set-password", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getWorkspaceSettings: () =>
    request<WorkspaceSettings>("/api/settings/workspace"),
  updateWorkspaceSettings: (body: {
    name?: string;
    productUrl?: string;
    productProfile?: ProductProfile;
  }) =>
    request<{ ok: true }>("/api/settings/workspace", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteWorkspace: (confirm: string) =>
    request<{ ok: true }>("/api/settings/workspace", {
      method: "DELETE",
      body: JSON.stringify({ confirm }),
    }),
  onboardingStatus: () => request<OnboardingStatus>("/api/onboarding/status"),
  analyzeUrl: (productUrl: string) =>
    request<{ profile: ProductProfile }>("/api/onboarding/analyze-url", {
      method: "POST",
      body: JSON.stringify({ productUrl }),
    }),
  analyzeDescription: (body: {
    description: string;
    category?: string;
    inspirations?: string[];
  }) =>
    request<{ profile: ProductProfile }>("/api/onboarding/analyze-description", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  analyzeDocument: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return postForm<{ profile: ProductProfile }>("/api/onboarding/analyze-document", form);
  },
  analyzeRepo: (repoUrl: string) =>
    request<{ profile: ProductProfile }>("/api/onboarding/analyze-repo", {
      method: "POST",
      body: JSON.stringify({ repoUrl }),
    }),
  patchOnboardingProgress: (step: OnboardingStep) =>
    request<{ ok: true }>("/api/onboarding/progress", {
      method: "PATCH",
      body: JSON.stringify({ step }),
    }),
  skipOnboarding: () =>
    request<{ ok: true }>("/api/onboarding/skip", { method: "POST" }),
  discoverCompetitors: (
    profile: ProductProfile,
    productUrl?: string | null,
    signal?: AbortSignal,
  ) =>
    request<{ competitors: DiscoveredCompetitor[] }>("/api/onboarding/discover", {
      method: "POST",
      body: JSON.stringify({ profile, productUrl: productUrl ?? null }),
      // When provided, the caller's abort signal replaces the default request
      // timeout — used by the onboarding background prefetch to cancel in-flight
      // discovery when the profile changes (patch-25).
      ...(signal ? { signal } : {}),
    }),
  getOnboardingSession: () =>
    request<{ session: OnboardingSession | null }>("/api/onboarding-session/current"),
  getActiveAnalysisSession: () =>
    request<{ session: OnboardingSession | null }>(
      "/api/onboarding-session/active-analysis",
    ),
  createOnboardingSession: (mode?: OnboardingMode) =>
    request<{ session: OnboardingSession }>("/api/onboarding-session", {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),
  patchOnboardingSession: (id: string, patch: OnboardingSessionPatch) =>
    request<{ session: OnboardingSession }>(`/api/onboarding-session/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  completeOnboardingSession: (id: string) =>
    request<{ session: OnboardingSession }>(`/api/onboarding-session/${id}/complete`, {
      method: "POST",
    }),
  // manualFields: profile keys the user typed by hand (vs accepted from a
  // re-analysis) — drives self-profile stickiness server-side (update modal).
  patchProductProfile: (
    profile: ProductProfile,
    manualFields?: Array<"category" | "audience" | "valueProp">,
  ) =>
    request<{ profile: ProductProfile }>("/api/onboarding/profile", {
      method: "PATCH",
      body: JSON.stringify({ profile, manualFields }),
    }),
  completeOnboarding: (body: {
    selectedCompetitors: Array<{ name: string; url: string; overlapScore?: number }>;
    savedCandidates?: Array<{ url: string; title?: string; overlapScore?: number; reason?: string }>;
    dismissedCandidates?: Array<{ url: string; title?: string; overlapScore?: number; reason?: string }>;
    monitoringPrefs: { frequency: "daily" | "weekly"; sources: Array<"homepage" | "pricing" | "blog"> };
    // Links the run to its resumable session so /complete can flip it to
    // analysis_in_progress (patch-25 — drives the dashboard streaming panel).
    onboardingSessionId?: string;
  }) =>
    request<{ competitorsCreated: number }>("/api/onboarding/complete", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // patch-28 — battle cards are per (product, competitor); productId scopes the
  // couple (the API defaults to the org's primary product when omitted).
  getBattleCard: (competitorId: string, productId?: string) =>
    request<{ battleCard: BattleCard }>(
      `/api/competitors/${competitorId}/battle-card${productId ? `?productId=${productId}` : ""}`,
    ),
  // Whether regenerating is worth it (patch-22): "fresh" → greyed-out button.
  getBattleCardStaleness: (competitorId: string, productId?: string) =>
    request<{
      staleness: "never_generated" | "fresh" | "outdated";
      needsRegeneration: boolean;
      lastGeneratedAt?: string;
      reason?: { userChanged: boolean; competitorChanged: boolean; flagged: boolean };
    }>(
      `/api/competitors/${competitorId}/battle-card/staleness${productId ? `?productId=${productId}` : ""}`,
    ),
  generateBattleCard: (competitorId: string, productId?: string) =>
    request<{ status: string; runId: string }>(
      `/api/competitors/${competitorId}/battle-card/generate${productId ? `?productId=${productId}` : ""}`,
      { method: "POST" },
    ),
  patchBattleCard: (competitorId: string, content: BattleCardContent, productId?: string) =>
    request<{ battleCard: BattleCard }>(
      `/api/competitors/${competitorId}/battle-card${productId ? `?productId=${productId}` : ""}`,
      { method: "PATCH", body: JSON.stringify({ content }) },
    ),
  battleCardPdfUrl: (competitorId: string, productId?: string) =>
    `${BASE}/api/competitors/${competitorId}/battle-card/pdf${productId ? `?productId=${productId}` : ""}`,
  // patch-29 — org-wide list for the dedicated battle cards page + overview section.
  listBattleCards: () =>
    request<{ battleCards: BattleCardSummary[] }>("/api/battle-cards"),
  listCandidates: (status?: "new" | "dismissed" | "added") =>
    request<{
      candidates: CompetitorCandidate[];
      counts: { new: number; dismissed: number };
    }>(`/api/candidates${status ? `?status=${status}` : ""}`),
  detectCandidates: () =>
    request<{ detected: number }>(`/api/candidates/detect`, { method: "POST" }),
  // Whether re-running discovery is worth it (patch-22): "fresh" → greyed-out button.
  getDiscoveryStaleness: () =>
    request<{
      staleness: "never_run" | "fresh" | "outdated";
      needsRediscovery: boolean;
      lastDiscoveryAt?: string;
      reason?: string;
    }>(`/api/candidates/staleness`),
  getDetectionConfig: () =>
    request<{ config: DetectionConfig; lastRunAt: string | null }>(
      `/api/candidates/config`,
    ),
  updateDetectionConfig: (config: DetectionConfig) =>
    request<{ config: DetectionConfig }>(`/api/candidates/config`, {
      method: "PUT",
      body: JSON.stringify(config),
    }),
  addCandidate: (id: string) =>
    request<{ competitor: Competitor; monitors: Monitor[] }>(
      `/api/candidates/${id}/add`,
      { method: "POST" },
    ),
  dismissCandidate: (id: string) =>
    request<{ ok: true }>(`/api/candidates/${id}/dismiss`, { method: "POST" }),
  dismissCandidates: (ids: string[]) =>
    request<{ dismissed: number }>(`/api/candidates/dismiss`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  restoreCandidates: (ids: string[]) =>
    request<{ restored: number }>(`/api/candidates/restore`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  getBilling: () => request<BillingInfo>("/api/billing"),
  createCheckout: (plan: Exclude<Plan, "free">, period: BillingPeriod) =>
    request<{ url: string }>("/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ plan, period }),
    }),
  openPortal: () =>
    request<{ url: string }>("/api/billing/portal", { method: "POST" }),
  submitFeedback: (body: {
    type: "bug" | "idea" | "other";
    message: string;
    pageUrl?: string;
    consoleErrors?: Array<{ ts: number; message: string }>;
    screenshot?: string;
    userAgent?: string;
  }) =>
    request<{ ok: true; id: string }>("/api/feedback", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getMyProduct: () => request<{ product: MyProduct | null }>("/api/my-product"),
  updateMyProduct: (patch: MyProductPatch) =>
    request<{ ok: true; profile: SelfProfile }>("/api/my-product", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  rescanMyProduct: (categories?: MyProductRescanCategory[]) =>
    request<{ ok: true; monitors: number }>("/api/my-product/rescan", {
      method: "POST",
      body: categories?.length ? JSON.stringify({ categories }) : undefined,
    }),
  setMyProductSite: (url: string) =>
    request<{ ok: true }>("/api/my-product/site", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  setMyProductRepo: (url: string) =>
    request<{ ok: true }>("/api/my-product/repo", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  listMyProductChanges: (status?: SelfChangeStatus) =>
    request<{ changes: SelfProductChange[] }>(
      `/api/my-product/changes${status ? `?status=${status}` : ""}`,
    ),
  // value = the curated result from the review sheet (granular pick / inline edit).
  // Omitted → accept the detected value as-is (and keep tracking the live site).
  acceptMyProductChange: (id: string, value?: string | string[]) =>
    request<{ ok: true; suggestion: { action: string; reason: string } | null }>(
      `/api/my-product/changes/${id}/accept`,
      { method: "POST", body: value !== undefined ? JSON.stringify({ value }) : undefined },
    ),
  modifyMyProductChange: (id: string) =>
    request<{ ok: true }>(`/api/my-product/changes/${id}/modify`, { method: "POST" }),
  ignoreMyProductChange: (id: string) =>
    request<{ ok: true }>(`/api/my-product/changes/${id}/ignore`, { method: "POST" }),

  // --- Admin ops (patch-02). All gated server-side by the email allowlist. ---
  adminSearchUsers: (q: string) =>
    request<{ users: AdminUserRow[] }>(
      `/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    ),
  adminGetUser: (id: string) => request<AdminUserDetail>(`/api/admin/users/${id}`),
  adminForceScrape: (monitorId: string) =>
    request<{ ok: boolean; runId: string }>(
      `/api/admin/monitors/${monitorId}/force-scrape`,
      { method: "POST" },
    ),
  adminUpdateFeedback: (id: string, status: AdminFeedbackStatus) =>
    request<{ ok: boolean }>(`/api/admin/feedback/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  adminListJobs: (params?: { status?: string; task?: string; after?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.task) q.set("task", params.task);
    if (params?.after) q.set("after", params.after);
    const qs = q.toString();
    return request<{ runs: AdminJobRun[]; nextCursor: string | null; error?: string }>(
      `/api/admin/jobs${qs ? `?${qs}` : ""}`,
    );
  },
  adminGetJob: (id: string) => request<{ run: AdminJobDetail }>(`/api/admin/jobs/${id}`),

  // --- Quality feedback (patch-21) ---
  submitQualityFeedback: (input: QualityFeedbackInput) =>
    request<{ ok: true; feedbackId: string; immediateAction: QualityImmediateAction | null }>(
      `/api/feedback-quality`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  getQualityFeedback: (targetType: QualityFeedbackTargetType, targetId: string) =>
    request<{ feedback: QualityFeedbackRow | null }>(
      `/api/feedback-quality?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`,
    ),
  getNpsStatus: () => request<{ eligible: boolean }>(`/api/feedback-quality/nps-status`),
  deleteQualityFeedback: (id: string) =>
    request<{ ok: true }>(`/api/feedback-quality/${id}`, { method: "DELETE" }),

  // --- Anti-hallucination (patch-24): user acknowledges a flagged output ---
  acknowledgeAiQuality: (targetType: "signal" | "battle_card" | "digest", targetId: string) =>
    request<{ ok: true }>(
      `/api/ai-quality/${targetType}/${encodeURIComponent(targetId)}/acknowledge`,
      { method: "POST" },
    ),
  // Admin: resolve a flagged output in the review queue (patch-24).
  adminResolveAiReview: (
    id: string,
    resolution: "correct" | "hallucination_confirmed" | "false_positive",
  ) =>
    request<{ ok: true }>(`/api/admin/ai-review/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolution }),
    }),

  // --- Edge cases scraping (patch-23) ---
  getMonitorAlternatives: (monitorId: string) =>
    request<{ alternatives: MonitorAlternative[] }>(`/api/monitor-alternatives/${monitorId}`),
  acceptAlternative: (id: string) =>
    request<{ ok: true; runId: string | null }>(`/api/monitor-alternatives/${id}/accept`, {
      method: "POST",
    }),
  rejectAlternative: (id: string) =>
    request<{ ok: true }>(`/api/monitor-alternatives/${id}/reject`, { method: "POST" }),
  submitManualSnapshot: (
    monitorId: string,
    input: { data: Record<string, unknown>; evidenceUrl?: string },
  ) =>
    request<{ snapshot: ManualSnapshotRow }>(`/api/manual-snapshots/${monitorId}`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getLatestManualSnapshot: (monitorId: string) =>
    request<{ snapshot: ManualSnapshotRow | null }>(`/api/manual-snapshots/${monitorId}/latest`),
  getStructuralChanges: (status = "detected") =>
    request<{ changes: StructuralChangeRow[] }>(
      `/api/structural-changes?status=${encodeURIComponent(status)}`,
    ),
  resolveStructuralChange: (id: string, resolution: string) =>
    request<{ ok: true; status: string }>(`/api/structural-changes/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolution }),
    }),
};

// --- Edge cases scraping (patch-23) types ---
export type AlternativeType =
  | "different_url"
  | "manual_data_entry"
  | "pause_source"
  | "replace_competitor";

export interface MonitorAlternative {
  id: string;
  monitorId: string;
  type: AlternativeType;
  description: string;
  suggestedUrl: string | null;
  rationale: string | null;
  status: string;
  createdAt: string;
}

export interface ManualSnapshotRow {
  id: string;
  monitorId: string;
  sourceType: string;
  data: Record<string, unknown>;
  evidenceUrl: string | null;
  enteredAt: string;
}

export type StructuralChangeType = "pivot" | "site_dead" | "acquired" | "category_shift";

export interface StructuralChangeRow {
  id: string;
  competitorId: string;
  competitorName: string | null;
  type: StructuralChangeType;
  evidence: Record<string, unknown>;
  confidence: string;
  status: string;
  detectedAt: string;
}

export interface AdminEdgeCases {
  windowDays: number;
  failuresByCategory: Record<string, number>;
  alternativesByStatus: Record<string, number>;
  structuralByStatus: Record<string, number>;
  apiCaptureEnabledMonitors: number;
}
