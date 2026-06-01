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

// Browser-side ceiling. Sits above the API's ClickHouse bound (~10s) so a slow
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

export interface ReviewsData {
  summary: {
    praises: Array<string | null>;
    complaints: Array<string | null>;
    lastUpdatedAt: string | null;
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
  sourceType: string;
  frequency: string;
  config: { url?: string } | null;
  lastRunAt: string | null;
  scrapeStartedAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  aiSummary: string | null;
  aiSummaryUpdatedAt: string | null;
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

export interface Signal {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  insight: string;
  soWhat: string | null;
  recommendedAction: string | null;
  isRead: boolean;
  createdAt: string;
  competitorId: string;
  competitorName: string;
  changeId: string;
  sourceType: string | null;
}

// User-safe "Why this insight?" payload (patch-14). No raw HTML, no diff, no AI
// classification — only what the user can read and act on.
export interface SignalDetail {
  id: string;
  insight: string;
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  detectedAt: string;
  humanChangeBefore: string | null;
  humanChangeAfter: string | null;
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
  createdAt: string;
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
  url: string;
  lastScanAt: string | null;
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
  };
  jobs: { total: number; items: MyProductJob[] };
}

export type SelfChangeStatus = "pending" | "accepted" | "modified" | "ignored";
export type SelfChangeSeverity = "minor" | "major";

export interface SelfProductChange {
  id: string;
  fieldPath: string;
  previousValue: unknown;
  newValue: unknown;
  summary: string | null;
  severity: SelfChangeSeverity;
  status: SelfChangeStatus;
  detectedAt: string;
  resolvedAt: string | null;
}

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
  };
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
  refreshCompetitorSummary: (id: string) =>
    request<{ runId: string }>(`/api/competitors/${id}/refresh-summary`, {
      method: "POST",
    }),
  runMonitor: (id: string) =>
    request<{ runId: string; monitorId: string }>(`/api/monitors/${id}/run`, { method: "POST" }),
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
    severity?: string;
    unreadOnly?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.competitorId) q.set("competitorId", params.competitorId);
    if (params?.severity) q.set("severity", params.severity);
    if (params?.unreadOnly) q.set("unreadOnly", "true");
    const qs = q.toString();
    return request<{ signals: Signal[] }>(`/api/signals${qs ? `?${qs}` : ""}`);
  },
  markSignalRead: (id: string) =>
    request<{ ok: true }>(`/api/signals/${id}/read`, { method: "PATCH" }),
  getSignalDetail: (id: string) =>
    request<{ signal: SignalDetail }>(`/api/signals/${id}/detail`),
  listSectoral: (params?: { limit?: number }) => {
    const qs = params?.limit ? `?limit=${params.limit}` : "";
    return request<{ signals: SectoralSignal[] }>(`/api/sectoral${qs}`);
  },
  markSectoralRead: (id: string) =>
    request<{ ok: true }>(`/api/sectoral/${id}/read`, { method: "POST" }),
  dismissSectoral: (id: string) =>
    request<{ ok: true }>(`/api/sectoral/${id}/dismiss`, { method: "POST" }),
  listDigests: () => request<{ digests: Digest[] }>("/api/digests"),
  getDigest: (id: string) => request<{ digest: Digest }>(`/api/digests/${id}`),
  generateDigest: (range: DigestRange = "this_week") =>
    request<{ digest: Digest | null; reason?: string }>("/api/digests/generate", {
      method: "POST",
      body: JSON.stringify({ range }),
    }),
  getNotificationSettings: () =>
    request<NotificationSettings>("/api/settings/notifications"),
  updateNotificationSettings: (body: Partial<NotificationSettings>) =>
    request<{ ok: true }>("/api/settings/notifications", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  sendTestAlert: () =>
    request<{
      results: Record<"email" | "slack" | "webhook", "sent" | "not_configured" | "error">;
      errors: Partial<Record<"email" | "slack" | "webhook", string>>;
    }>("/api/notifications/test", { method: "POST" }),
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
  discoverCompetitors: (profile: ProductProfile, productUrl?: string | null) =>
    request<{ competitors: DiscoveredCompetitor[] }>("/api/onboarding/discover", {
      method: "POST",
      body: JSON.stringify({ profile, productUrl: productUrl ?? null }),
    }),
  patchProductProfile: (profile: ProductProfile) =>
    request<{ profile: ProductProfile }>("/api/onboarding/profile", {
      method: "PATCH",
      body: JSON.stringify({ profile }),
    }),
  completeOnboarding: (body: {
    selectedCompetitors: Array<{ name: string; url: string; overlapScore?: number }>;
    savedCandidates?: Array<{ url: string; title?: string; overlapScore?: number; reason?: string }>;
    dismissedCandidates?: Array<{ url: string; title?: string; overlapScore?: number; reason?: string }>;
    monitoringPrefs: { frequency: "daily" | "weekly"; sources: Array<"homepage" | "pricing" | "blog"> };
  }) =>
    request<{ competitorsCreated: number }>("/api/onboarding/complete", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getBattleCard: (competitorId: string) =>
    request<{ battleCard: BattleCard }>(`/api/competitors/${competitorId}/battle-card`),
  generateBattleCard: (competitorId: string) =>
    request<{ status: string; runId: string }>(
      `/api/competitors/${competitorId}/battle-card/generate`,
      { method: "POST" },
    ),
  patchBattleCard: (competitorId: string, content: BattleCardContent) =>
    request<{ battleCard: BattleCard }>(`/api/competitors/${competitorId}/battle-card`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),
  battleCardPdfUrl: (competitorId: string) =>
    `${BASE}/api/competitors/${competitorId}/battle-card/pdf`,
  listCandidates: (status?: "new" | "dismissed" | "added") =>
    request<{ candidates: CompetitorCandidate[] }>(
      `/api/candidates${status ? `?status=${status}` : ""}`,
    ),
  detectCandidates: () =>
    request<{ detected: number }>(`/api/candidates/detect`, { method: "POST" }),
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
  rescanMyProduct: () =>
    request<{ ok: true; monitors: number }>("/api/my-product/rescan", { method: "POST" }),
  listMyProductChanges: (status?: SelfChangeStatus) =>
    request<{ changes: SelfProductChange[] }>(
      `/api/my-product/changes${status ? `?status=${status}` : ""}`,
    ),
  acceptMyProductChange: (id: string) =>
    request<{ ok: true; suggestion: { action: string; reason: string } | null }>(
      `/api/my-product/changes/${id}/accept`,
      { method: "POST" },
    ),
  modifyMyProductChange: (id: string) =>
    request<{ ok: true }>(`/api/my-product/changes/${id}/modify`, { method: "POST" }),
  ignoreMyProductChange: (id: string) =>
    request<{ ok: true }>(`/api/my-product/changes/${id}/ignore`, { method: "POST" }),
};
