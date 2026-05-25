const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

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
  createdAt: string;
  updatedAt: string;
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
  changeId?: string;
}

export interface Monitor {
  id: string;
  competitorId: string;
  sourceType: string;
  frequency: string;
  lastRunAt: string | null;
}

export interface ChangeRow {
  id: string;
  diffText: string | null;
  detectedAt: string;
  monitorId: string;
  sourceType: string;
  competitorId: string;
  competitorName: string;
  competitorUrl: string;
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
}

export interface DigestSection {
  urgency: "action_required" | "watch" | "fyi";
  competitor: string;
  category: string;
  insight: string;
  so_what: string;
}

export interface DigestContent {
  temperature: "calme" | "modérée" | "agitée";
  tldr: string[];
  sections: DigestSection[];
}

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
  digestEmail: string | null;
  digestEnabled: boolean;
  alertsEnabled: boolean;
}

export interface ProductProfile {
  category: string;
  audience: string;
  valueProp: string;
  pricingModel: string;
}

export interface OnboardingStatus {
  onboardingCompleted: boolean;
  productUrl: string | null;
  profile: ProductProfile | null;
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
  firstSeenAt: string;
}

export const api = {
  listCompetitors: () => request<{ competitors: Competitor[] }>("/api/competitors"),
  getCompetitor: (id: string) =>
    request<{
      competitor: Competitor;
      monitors: Monitor[];
      recentChanges: ChangeRow[];
      recentSignals: CompetitorSignal[];
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
  getCompetitorSignals: (id: string, limit = 50) =>
    request<{ signals: CompetitorSignal[] }>(`/api/competitors/${id}/signals?limit=${limit}`),
  createCompetitor: (body: { name: string; url: string; description?: string }) =>
    request<{ competitor: Competitor; monitors: Monitor[] }>("/api/competitors", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteCompetitor: (id: string) =>
    request<{ ok: true }>(`/api/competitors/${id}`, { method: "DELETE" }),
  runMonitor: (id: string) =>
    request<{ runId: string; monitorId: string }>(`/api/monitors/${id}/run`, { method: "POST" }),
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
  listDigests: () => request<{ digests: Digest[] }>("/api/digests"),
  getDigest: (id: string) => request<{ digest: Digest }>(`/api/digests/${id}`),
  getNotificationSettings: () =>
    request<NotificationSettings>("/api/settings/notifications"),
  updateNotificationSettings: (body: Partial<NotificationSettings>) =>
    request<{ ok: true }>("/api/settings/notifications", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  onboardingStatus: () => request<OnboardingStatus>("/api/onboarding/status"),
  analyzeProduct: (productUrl: string) =>
    request<{ profile: ProductProfile }>("/api/onboarding/analyze", {
      method: "POST",
      body: JSON.stringify({ productUrl }),
    }),
  discoverCompetitors: (productUrl: string, profile: ProductProfile) =>
    request<{ competitors: DiscoveredCompetitor[] }>("/api/onboarding/discover", {
      method: "POST",
      body: JSON.stringify({ productUrl, profile }),
    }),
  patchProductProfile: (profile: ProductProfile) =>
    request<{ profile: ProductProfile }>("/api/onboarding/profile", {
      method: "PATCH",
      body: JSON.stringify({ profile }),
    }),
  completeOnboarding: (body: {
    selectedCompetitors: Array<{ name: string; url: string; overlapScore?: number }>;
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
  addCandidate: (id: string) =>
    request<{ competitor: Competitor; monitors: Monitor[] }>(
      `/api/candidates/${id}/add`,
      { method: "POST" },
    ),
  dismissCandidate: (id: string) =>
    request<{ ok: true }>(`/api/candidates/${id}/dismiss`, { method: "POST" }),
};
