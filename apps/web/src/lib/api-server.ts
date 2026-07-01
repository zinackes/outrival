import { cookies } from "next/headers";
import { endOfDay, startOfDay, subDays } from "date-fns";
import type { Plan } from "@outrival/shared";
import type {
  Signal,
  Competitor,
  TrendsSummary,
  Digest,
  SectoralSignal,
  SectoralEligibility,
  ActivitySource,
  ActivityUpcoming,
  ActivityEvent,
  ProductSummary,
  ProductDetail,
  MyProduct,
  SelfProductChange,
  CompetitorCandidate,
  BattleCardSummary,
  WorkspaceSettings,
  NotificationSettings,
  UsageSnapshot,
  BillingInfo,
  NotificationPreferences,
  RelevanceThresholdInfo,
  AiVisibilityData,
  OnboardingChecklist,
  StructuralChangeRow,
  AiStatus,
} from "./api";
import type { CompetitorData } from "@/app/dashboard/competitors/[id]/competitor-detail-view";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Server-side GET that forwards the caller's session cookie to the API.
// CORS doesn't apply server-to-server, so the only thing the API needs is the
// auth cookie — which lives on `.outrival.app` and reaches this web server too.
async function serverGet<T>(path: string): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`server API ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

// Best-effort variant: null on any failure (missing cookie, plan-gated 403, API
// down) so a secondary seed never nulls the whole aggregate — the matching client
// query just re-fetches. Use for optional/gated surfaces, not the primary payload.
async function tryGet<T>(path: string): Promise<T | null> {
  try {
    return await serverGet<T>(path);
  } catch {
    return null;
  }
}

/**
 * Prefetch the dashboard overview data on the server so it lands in the first
 * paint instead of after JS hydration + a browser round-trip.
 *
 * Best-effort by design: any failure (cookie missing, API down, hairpin
 * blocked) returns null and OverviewView falls back to its own client fetch.
 * The page is therefore never slower than before — only faster when this hits.
 */
export async function getOverviewData(productId?: string): Promise<{
  signals: Signal[];
  competitors: Competitor[];
  sectoral: SectoralSignal[] | null;
  battleCards: BattleCardSummary[] | null;
  checklist: OnboardingChecklist | null;
} | null> {
  // patch-28 — an optional product scope filters both feeds; absent → org-wide.
  const scope = productId ? `&productId=${encodeURIComponent(productId)}` : "";
  const compScope = productId ? `?productId=${encodeURIComponent(productId)}` : "";
  try {
    // signals + competitors gate the whole seed (their failure nulls it, keeping
    // the prior contract). The three secondary Overview sections are best-effort
    // (tryGet → null), so a plan-gated sectoral teaser or a checklist blip never
    // sinks the hero feeds; each falls back to its own client fetch.
    const [s, c, sectoral, cards, checklist] = await Promise.all([
      serverGet<{ signals: Signal[] }>(`/api/signals?limit=200${scope}`),
      serverGet<{ competitors: Competitor[] }>(`/api/competitors${compScope}`),
      tryGet<{ signals: SectoralSignal[] }>(`/api/sectoral?limit=3`),
      tryGet<{ battleCards: BattleCardSummary[] }>(`/api/battle-cards`),
      tryGet<OnboardingChecklist>(`/api/onboarding/checklist`),
    ]);
    return {
      signals: s.signals,
      competitors: c.competitors,
      sectoral: sectoral?.signals ?? null,
      battleCards: cards?.battleCards ?? null,
      checklist: checklist ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Prefetch the always-on dashboard shell widgets (mounted by the layout on every
 * page): the product-scope switcher's roster, the structural-change banner, and
 * the AI-degradation banner. Each is independently best-effort — a null just lets
 * that widget fetch client-side as before. Seeded once in the layout so these
 * don't cost three client round-trips on every dashboard navigation.
 */
export async function getShellData(): Promise<{
  products: ProductSummary[] | null;
  structuralChanges: StructuralChangeRow[] | null;
  aiStatus: AiStatus | null;
}> {
  const [products, structural, aiStatus] = await Promise.all([
    tryGet<{ products: ProductSummary[] }>(`/api/products`),
    tryGet<{ changes: StructuralChangeRow[] }>(
      `/api/structural-changes?status=detected`,
    ),
    tryGet<AiStatus>(`/api/system/ai-status`),
  ]);
  return {
    products: products?.products ?? null,
    structuralChanges: structural?.changes ?? null,
    aiStatus: aiStatus ?? null,
  };
}

/**
 * Prefetch the signals feed. The page passes the URL's product/sort so the seed
 * matches what SignalsView would fetch on mount (other filters are client-side).
 * Best-effort: null → SignalsView falls back to its own client fetch.
 */
export async function getSignalsData(params: {
  productId?: string;
  sort?: "threat" | "recent";
}): Promise<Signal[] | null> {
  const q = new URLSearchParams({ limit: "200", sort: params.sort ?? "threat" });
  if (params.productId) q.set("productId", params.productId);
  try {
    const r = await serverGet<{ signals: Signal[] }>(`/api/signals?${q.toString()}`);
    return r.signals;
  } catch {
    return null;
  }
}

/**
 * Prefetch the competitors list (with per-competitor stats). Best-effort: null →
 * CompetitorsList falls back to its own client fetch + keeps its 30s polling.
 */
export async function getCompetitorsData(productId?: string): Promise<Competitor[] | null> {
  const scope = productId ? `?productId=${encodeURIComponent(productId)}` : "";
  try {
    const r = await serverGet<{ competitors: Competitor[] }>(`/api/competitors${scope}`);
    return r.competitors;
  } catch {
    return null;
  }
}

/**
 * Prefetch a single competitor's detail (competitor + monitors + changes +
 * signals + tech stack + overview + plan). Best-effort: null → the detail view
 * falls back to its own client fetch.
 */
export async function getCompetitorDetailData(
  id: string,
): Promise<CompetitorData | null> {
  try {
    return await serverGet<CompetitorData>(`/api/competitors/${id}`);
  } catch {
    return null;
  }
}

/**
 * Prefetch the trends summary for the default 90-day window (matching
 * TrendsView's initial range = lastNDays(90)). Best-effort: null → TrendsView
 * falls back to its own client fetch. Drill-down series stay client-side.
 */
// AI Visibility seed. Org-level (no product scope). Best-effort: null on any failure
// (incl. the 403 plan_locked_feature for free/starter) → the client query re-fetches
// and the view renders the locked/empty state from the error.
export async function getAiVisibilityData(): Promise<AiVisibilityData | null> {
  try {
    return await serverGet<AiVisibilityData>("/api/ai-visibility");
  } catch {
    return null;
  }
}

export async function getTrendsData(productId?: string): Promise<TrendsSummary | null> {
  const from = startOfDay(subDays(new Date(), 90));
  const to = endOfDay(new Date());
  const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  if (productId) q.set("productId", productId);
  try {
    return await serverGet<TrendsSummary>(`/api/trends/summary?${q.toString()}`);
  } catch {
    return null;
  }
}

/**
 * Prefetch the digests list. Best-effort: null → DigestsView falls back to its
 * own client fetch.
 */
export async function getDigestsData(): Promise<Digest[] | null> {
  try {
    const r = await serverGet<{ digests: Digest[] }>("/api/digests");
    return r.digests;
  } catch {
    return null;
  }
}

/**
 * Prefetch the sectoral feed's default page (no category, active view) — must
 * match SectoralFeed's initial fetch (limit 25). Best-effort: null → the feed
 * falls back to its own client fetch. Pagination + filters stay client-side.
 */
export async function getSectoralData(): Promise<{
  signals: SectoralSignal[];
  eligibility: SectoralEligibility | null;
} | null> {
  try {
    return await serverGet<{
      signals: SectoralSignal[];
      eligibility: SectoralEligibility | null;
    }>("/api/sectoral?limit=25");
  } catch {
    return null;
  }
}

/**
 * Prefetch the activity page's two mount fetches: health (sources + upcoming)
 * and the default (unfiltered) timeline page (limit 25). Best-effort: null →
 * ActivityView falls back to its own client fetches.
 */
export async function getActivityData(productId?: string): Promise<{
  sources: ActivitySource[];
  upcoming: ActivityUpcoming[];
  events: ActivityEvent[];
  total: number;
} | null> {
  const healthScope = productId ? `?productId=${encodeURIComponent(productId)}` : "";
  const tlScope = productId ? `&productId=${encodeURIComponent(productId)}` : "";
  try {
    const [health, timeline] = await Promise.all([
      serverGet<{ sources: ActivitySource[]; upcoming: ActivityUpcoming[] }>(
        `/api/activity/health${healthScope}`,
      ),
      serverGet<{ events: ActivityEvent[]; total: number }>(
        `/api/activity/timeline?limit=25${tlScope}`,
      ),
    ]);
    return {
      sources: health.sources,
      upcoming: health.upcoming ?? [],
      events: timeline.events,
      total: timeline.total,
    };
  } catch {
    return null;
  }
}

/**
 * Prefetch the compare picker's raw inputs (products + competitors). The view
 * derives the entity list + default selection from these. Best-effort: null →
 * CompareView falls back to its own client fetch. The matrix stays client-side
 * (it tracks the user's live selection).
 */
export async function getCompareData(productId?: string): Promise<{
  products: ProductSummary[];
  competitors: Competitor[];
} | null> {
  const scope = productId ? `?productId=${encodeURIComponent(productId)}` : "";
  try {
    const [p, c] = await Promise.all([
      serverGet<{ products: ProductSummary[] }>("/api/products"),
      serverGet<{ competitors: Competitor[] }>(`/api/competitors${scope}`),
    ]);
    return { products: p.products, competitors: c.competitors };
  } catch {
    return null;
  }
}

/**
 * Prefetch the "My product" page: the product itself + its pending changes.
 * Best-effort: null → MyProductView falls back to its own client fetch (which
 * also drives the scan polling).
 */
/** The org's products (SKUs) + plan/limit. Best-effort: null on failure. Used by
 * /dashboard/products to redirect to the primary product's detail page. */
export async function getProductsList(): Promise<{
  products: ProductSummary[];
  plan: string;
  limit: number;
} | null> {
  try {
    return await serverGet<{ products: ProductSummary[]; plan: string; limit: number }>(
      "/api/products",
    );
  } catch {
    return null;
  }
}

/** A single product's row + linked competitors (the [id] detail page). */
export async function getProductDetailData(id: string): Promise<ProductDetail | null> {
  try {
    return await serverGet<ProductDetail>(`/api/products/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

export async function getMyProductData(productId?: string): Promise<{
  product: MyProduct | null;
  changes: SelfProductChange[];
} | null> {
  // patch-28 — an optional productId scopes the seed to a given product's self
  // (the [id] detail page passes it). Omitted → the primary, identical to before.
  const suffix = productId ? `&productId=${encodeURIComponent(productId)}` : "";
  const productPath = productId
    ? `/api/my-product?productId=${encodeURIComponent(productId)}`
    : "/api/my-product";
  try {
    const [p, c] = await Promise.all([
      serverGet<{ product: MyProduct | null }>(productPath),
      serverGet<{ changes: SelfProductChange[] }>(
        `/api/my-product/changes?status=pending${suffix}`,
      ),
    ]);
    return { product: p.product, changes: c.changes };
  } catch {
    return null;
  }
}

/**
 * Prefetch the discovery page: the "new" candidates queue (+ tab counts) and the
 * staleness flag that gates the re-run button. Best-effort: null → the view
 * falls back to its own client fetches. Tab switches stay client-side.
 */
export async function getDiscoveryData(productId?: string): Promise<{
  candidates: CompetitorCandidate[];
  counts: { new: number; dismissed: number };
  discoveryFresh: boolean;
} | null> {
  try {
    const scope = productId ? `&productId=${productId}` : "";
    const staleScope = productId ? `?productId=${productId}` : "";
    const [list, staleness] = await Promise.all([
      serverGet<{
        candidates: CompetitorCandidate[];
        counts: { new: number; dismissed: number };
      }>(`/api/candidates?status=new${scope}`),
      serverGet<{ needsRediscovery: boolean }>(
        `/api/candidates/staleness${staleScope}`,
      ),
    ]);
    return {
      candidates: list.candidates,
      counts: list.counts,
      discoveryFresh: !staleness.needsRediscovery,
    };
  } catch {
    return null;
  }
}

/**
 * Prefetch the battle cards list. Best-effort: null → BattleCardsView falls back
 * to its own client fetch.
 */
export async function getBattleCardsData(): Promise<BattleCardSummary[] | null> {
  try {
    const r = await serverGet<{ battleCards: BattleCardSummary[] }>(
      "/api/battle-cards",
    );
    return r.battleCards;
  } catch {
    return null;
  }
}

/**
 * Prefetch the General settings (workspace name, product URL, discovery profile).
 * Best-effort: null → WorkspaceSettingsForm falls back to its own client fetch.
 */
export async function getWorkspaceSettingsData(): Promise<WorkspaceSettings | null> {
  try {
    return await serverGet<WorkspaceSettings>("/api/settings/workspace");
  } catch {
    return null;
  }
}

/**
 * Prefetch the Products settings: the products list + plan + tier limit.
 * Best-effort: null → ProductsSettings falls back to its own client fetch.
 */
export async function getProductsSettingsData(): Promise<{
  products: ProductSummary[];
  plan: string;
  limit: number;
} | null> {
  try {
    return await serverGet<{
      products: ProductSummary[];
      plan: string;
      limit: number;
    }>("/api/products");
  } catch {
    return null;
  }
}

/**
 * Prefetch the Usage dashboard snapshot. Best-effort: null → UsageDashboard
 * falls back to its own client fetch.
 */
export async function getUsageData(): Promise<UsageSnapshot | null> {
  try {
    return await serverGet<UsageSnapshot>("/api/usage");
  } catch {
    return null;
  }
}

/**
 * Prefetch the billing dashboard. Best-effort: null → BillingDashboard falls
 * back to its own client fetch.
 */
export async function getBillingData(): Promise<BillingInfo | null> {
  try {
    return await serverGet<BillingInfo>("/api/billing");
  } catch {
    return null;
  }
}

/**
 * Prefetch the Notifications page's two forms: moderation (preferences +
 * relevance threshold) and digest (notification settings + plan). Best-effort:
 * null → each form falls back to its own client fetch.
 */
export async function getNotificationsPageData(): Promise<{
  moderation: { preferences: NotificationPreferences; threshold: RelevanceThresholdInfo };
  digest: { settings: NotificationSettings; plan: Plan };
} | null> {
  try {
    const [prefs, threshold, settings, billing] = await Promise.all([
      serverGet<{ preferences: NotificationPreferences }>(
        "/api/notification-preferences",
      ),
      serverGet<RelevanceThresholdInfo>(
        "/api/notification-preferences/relevance-threshold",
      ),
      serverGet<NotificationSettings>("/api/settings/notifications"),
      serverGet<{ plan: Plan }>("/api/billing"),
    ]);
    return {
      moderation: { preferences: prefs.preferences, threshold },
      digest: { settings, plan: billing.plan },
    };
  } catch {
    return null;
  }
}
