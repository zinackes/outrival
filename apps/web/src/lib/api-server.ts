import { cache } from "react";
import { cookies } from "next/headers";
import { endOfDay, startOfDay, subDays } from "date-fns";
import type { Plan } from "@outrival/shared";
import { OVERVIEW_SIGNALS_LIMIT, SIGNALS_PAGE_SIZE } from "./queries";
import type {
  Signal,
  SignalsPage,
  SignalsFacets,
  Competitor,
  TrendsSummary,
  TrendsMarket,
  Digest,
  DigestDetail,
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
  DiscoveryBasis,
  DiscoveryStaleness,
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

// Request-scoped GET, deduped by path via React.cache: when the layout and the
// page (or two loaders) fetch the same endpoint within one render — e.g. /api/products
// on the compare/products routes — the round-trip runs once and both callers share it.
// Non-generic so it composes with cache(); serverGet is the thin typed wrapper.
const cachedGet = cache(async (path: string): Promise<unknown> => {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`server API ${path} -> ${res.status}`);
  return res.json();
});

// Server-side GET that forwards the caller's session cookie to the API.
// CORS doesn't apply server-to-server, so the only thing the API needs is the
// auth cookie — which lives on `.outrival.app` and reaches this web server too.
async function serverGet<T>(path: string): Promise<T> {
  return (await cachedGet(path)) as T;
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
  health: { sources: ActivitySource[]; upcoming: ActivityUpcoming[] } | null;
  digests: Digest[] | null;
} | null> {
  // patch-28 — an optional product scope filters both feeds; absent → org-wide.
  const scope = productId ? `&productId=${encodeURIComponent(productId)}` : "";
  const compScope = productId ? `?productId=${encodeURIComponent(productId)}` : "";
  try {
    // signals + competitors gate the whole seed (their failure nulls it, keeping
    // the prior contract). The secondary Overview sections are best-effort
    // (tryGet → null), so a plan-gated sectoral teaser or a checklist blip never
    // sinks the hero feeds; each falls back to its own client fetch.
    //
    // sort=recent must match overviewSignalsQuery, or the seed writes a cache entry
    // the view never reads (and the view then fetches anyway).
    const [s, c, sectoral, cards, checklist, health, digests] = await Promise.all([
      serverGet<{ signals: Signal[] }>(
        `/api/signals?limit=${OVERVIEW_SIGNALS_LIMIT}&sort=recent${scope}`,
      ),
      serverGet<{ competitors: Competitor[] }>(`/api/competitors${compScope}`),
      tryGet<{ signals: SectoralSignal[] }>(`/api/sectoral?limit=3`),
      tryGet<{ battleCards: BattleCardSummary[] }>(`/api/battle-cards`),
      tryGet<OnboardingChecklist>(`/api/onboarding/checklist`),
      tryGet<{ sources: ActivitySource[]; upcoming: ActivityUpcoming[] }>(
        `/api/activity/health${compScope}`,
      ),
      tryGet<{ digests: Digest[] }>(`/api/digests`),
    ]);
    return {
      signals: s.signals,
      competitors: c.competitors,
      sectoral: sectoral?.signals ?? null,
      battleCards: cards?.battleCards ?? null,
      checklist: checklist ?? null,
      health: health ?? null,
      digests: digests?.digests ?? null,
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
 * Prefetch the paginated Signals feed's first page + its facets. The page passes the
 * URL's product/sort so the seed matches the "no filters" key SignalsView reads on
 * mount (any active filter yields a different key → a client fetch). Both best-effort.
 */
export async function getSignalsFeedPage(params: {
  productId?: string;
  sort?: "threat" | "recent";
}): Promise<SignalsPage | null> {
  const q = new URLSearchParams({
    limit: String(SIGNALS_PAGE_SIZE),
    sort: params.sort ?? "threat",
  });
  if (params.productId) q.set("productId", params.productId);
  return tryGet<SignalsPage>(`/api/signals?${q.toString()}`);
}

export async function getSignalsFacets(productId?: string): Promise<SignalsFacets | null> {
  const qs = productId ? `?productId=${encodeURIComponent(productId)}` : "";
  return tryGet<SignalsFacets>(`/api/signals/facets${qs}`);
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
// AI Visibility seed. patch-28: scoped to the active product (self + its competitors);
// "all products" (no id) uses the primary product's self. Surfaces the plan-locked 403
// distinctly (`locked`) so the page renders the upsell server-side — no client round-trip,
// no skeleton flash for the free/starter majority. Any other failure → { locked:false,
// data:null } and the client query re-fetches to render the empty/error state.
export async function getAiVisibilitySeed(
  productId?: string,
): Promise<{ locked: boolean; data: AiVisibilityData | null }> {
  const scope = productId ? `?productId=${encodeURIComponent(productId)}` : "";
  try {
    const cookieHeader = (await cookies()).toString();
    const res = await fetch(`${BASE}/api/ai-visibility${scope}`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (res.status === 403) return { locked: true, data: null };
    if (!res.ok) return { locked: false, data: null };
    return { locked: false, data: (await res.json()) as AiVisibilityData };
  } catch {
    return { locked: false, data: null };
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
 * Prefetch the cross-competitor market series behind the trends charts. Seeded
 * beside the summary so the report's charts paint with the page instead of
 * popping in a beat later. Best-effort: null → TrendsView fetches client-side.
 */
export async function getTrendsMarketData(productId?: string): Promise<TrendsMarket | null> {
  const from = startOfDay(subDays(new Date(), 90));
  const to = endOfDay(new Date());
  const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  if (productId) q.set("productId", productId);
  try {
    return await serverGet<TrendsMarket>(`/api/trends/market?${q.toString()}`);
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
 * Prefetch a single digest for the reader route. Best-effort: null → the reader's
 * useQuery fetches client-side (and the page renders notFound on a hard miss).
 */
export async function getDigestDetailData(id: string): Promise<DigestDetail | null> {
  return await tryGet<DigestDetail>(`/api/digests/${encodeURIComponent(id)}`);
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
      // The log's first page: the outcomes that carry a finding, matching
      // ACTIVITY_FINDING_STATUSES so the seed lands on the client's page-1 key.
      // The summary (strip + day tallies) is NOT seeded — its key carries the
      // viewer's timezone offset, which the server cannot know without guessing.
      serverGet<{ events: ActivityEvent[]; total: number }>(
        `/api/activity/timeline?limit=25&status=change,first_capture,failed${tlScope}`,
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
  ranking: Record<string, number>;
} | null> {
  const scope = productId ? `?productId=${encodeURIComponent(productId)}` : "";
  try {
    const [p, c, r] = await Promise.all([
      serverGet<{ products: ProductSummary[] }>("/api/products"),
      serverGet<{ competitors: Competitor[] }>(`/api/competitors${scope}`),
      // Best-effort: ranking is a picker-ordering nicety, never a blocker.
      serverGet<{ ranking: Record<string, number> }>("/api/compare/ranking").catch(() => ({
        ranking: {},
      })),
    ]);
    return { products: p.products, competitors: c.competitors, ranking: r.ranking };
  } catch {
    return null;
  }
}

/**
 * Prefetch the "My product" page: the product itself + its pending changes.
 * Best-effort: null → MyProductView falls back to its own client fetch (which
 * also drives the scan polling).
 */
/** The org's products (SKUs) + plan/limit, each carrying the portfolio's
 * aggregates (capture health, activity, price band). Best-effort: null on
 * failure. Seeds /dashboard/products, which renders the portfolio or redirects
 * to a single product depending on the active scope. */
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
 * Prefetch the discovery page: the "new" queue with everything the reading is made
 * of (counts, competitor seats, what the search ran on) plus the staleness record
 * behind the scan button. Both are seeded so the page's first paint states its
 * verdict instead of a skeleton. Best-effort: null → the view falls back to its own
 * client fetches. Tab switches stay client-side.
 */
export async function getDiscoveryData(productId?: string): Promise<{
  list: {
    candidates: CompetitorCandidate[];
    counts: { new: number; dismissed: number; added: number };
    seats: { used: number; limit: number };
    basis: DiscoveryBasis;
  };
  staleness: DiscoveryStaleness;
} | null> {
  try {
    const scope = productId ? `&productId=${productId}` : "";
    const staleScope = productId ? `?productId=${productId}` : "";
    const [list, staleness] = await Promise.all([
      serverGet<{
        candidates: CompetitorCandidate[];
        counts: { new: number; dismissed: number; added: number };
        seats: { used: number; limit: number };
        basis: DiscoveryBasis;
      }>(`/api/candidates?status=new${scope}`),
      serverGet<DiscoveryStaleness>(`/api/candidates/staleness${staleScope}`),
    ]);
    return { list, staleness };
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
      // Only `.plan` is read here — ?summary=1 skips the endpoint's Stripe calls.
      serverGet<{ plan: Plan }>("/api/billing?summary=1"),
    ]);
    return {
      moderation: { preferences: prefs.preferences, threshold },
      digest: { settings, plan: billing.plan },
    };
  } catch {
    return null;
  }
}
