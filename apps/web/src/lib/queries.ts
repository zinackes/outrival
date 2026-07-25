import { queryOptions, infiniteQueryOptions } from "@tanstack/react-query";
import { api, ApiError, type ActivityStatusFilter, type SignalsFeedParams } from "./api";

/**
 * Shared query definitions — one source of truth for `queryKey` + `queryFn`,
 * reused by client `useQuery` AND server-side seeding. The key is the hydration
 * contract: a Server Component seeds these exact keys (see `lib/server-query.ts`)
 * and the matching `useQuery` on the client reads them instead of refetching.
 *
 * Add a factory here per endpoint as the app migrates onto TanStack Query.
 * See docs/tanstack-query.md.
 */

type SignalsParams = {
  limit?: number;
  competitorId?: string;
  productId?: string;
  sort?: "threat" | "recent";
};

// Signals feed. Distinct params → distinct cache entries (the key embeds them),
// so the param-less Overview seed and the sorted/filtered Signals page don't
// collide. TanStack hashes object keys stably, so seed and read need only pass
// equal params, not the same object identity.
export function signalsQuery(params: SignalsParams = {}) {
  return queryOptions({
    queryKey: ["signals", params] as const,
    queryFn: () => api.listSignals(params).then((r) => r.signals),
  });
}

// The Overview's feed: the newest N signals, chronological.
//
// "recent" (not the default threat order) because every number on that page is
// windowed — the period count, the comparison against the period before, the
// per-bucket bars — and a threat-ranked page of 200 is an arbitrary sample of the
// calendar. One factory so the cache key has a single definition, shared by the
// view, the RSC seed and the onboarding poller that invalidates it.
export const OVERVIEW_SIGNALS_LIMIT = 200;

export function overviewSignalsQuery(productId?: string) {
  return signalsQuery({ limit: OVERVIEW_SIGNALS_LIMIT, productId, sort: "recent" });
}

// Page size for the paginated Signals feed. Shared so the SSR seed (first page) and
// the client's initial page hit the same limit → the same cache entry.
export const SIGNALS_PAGE_SIZE = 50;

// Paginated Signals feed (offset "load more"). All filters resolve server-side and are
// embedded in the key, so switching any filter/sort/view refetches. The "no filters"
// params ({ productId?, sort }) match the SSR seed key exactly (see signals/page.tsx).
export function signalsFeedQuery(params: SignalsFeedParams) {
  return infiniteQueryOptions({
    queryKey: ["signals", "feed", params] as const,
    queryFn: ({ pageParam }) =>
      api.listSignalsPage({ ...params, limit: SIGNALS_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
}

// Feed facets — tab counts + the filter dropdown options (categories/competitors),
// product-scoped and independent of the active filters. Slow-changing; polled alongside
// the feed so the tab counts stay live without recounting on every filter change.
export function signalsFacetsQuery(productId?: string) {
  return queryOptions({
    queryKey: ["signals", "facets", productId ?? null] as const,
    queryFn: () => api.getSignalsFacets(productId),
  });
}

// Org competitor roster (with per-competitor stats). patch-28 — an optional productId
// scopes to a product's linked competitors; omitted keeps the exact ["competitors"]
// key (zero regression for the existing callers).
export function competitorsQuery(productId?: string) {
  const key = productId ? (["competitors", productId] as const) : (["competitors"] as const);
  return queryOptions({
    queryKey: key,
    queryFn: () => api.listCompetitors(productId).then((r) => r.competitors),
  });
}

// Compare picker ranking — per-competitor data-completeness score keyed by id.
// Orders the picker/default columns toward the competitors worth comparing.
// Best-effort: an empty map degrades to overlap order client-side.
export function compareRankingQuery() {
  return queryOptions({
    queryKey: ["compare", "ranking"] as const,
    queryFn: () => api.getCompareRanking().then((r) => r.ranking),
  });
}

// Full competitor detail (the [id] page: competitor + monitors + recent changes/
// signals + tech stack + overview + plan). Distinct ["competitor", id, "detail"]
// key from the per-tab queries (["competitor", id, "jobs"|"pricingHistory"|…]).
export function competitorDetailQuery(id: string) {
  return queryOptions({
    queryKey: ["competitor", id, "detail"] as const,
    queryFn: () => api.getCompetitor(id),
  });
}

// Digests list (weekly + daily records).
export function digestsQuery() {
  return queryOptions({
    queryKey: ["digests"] as const,
    queryFn: () => api.listDigests().then((r) => r.digests),
  });
}

// Single digest — backs the /dashboard/digests/[id] reader route. Carries the
// server-resolved section links (competitor + signal per move) and the period's
// provenance alongside the row, so the reader can be a document with exits rather
// than a dead end.
export function digestDetailQuery(id: string) {
  return queryOptions({
    queryKey: ["digest", id] as const,
    queryFn: () => api.getDigest(id),
  });
}

// Battle cards list (org-wide, across products).
export function battleCardsQuery() {
  return queryOptions({
    queryKey: ["battleCards"] as const,
    queryFn: () => api.listBattleCards().then((r) => r.battleCards),
  });
}

// Plan usage snapshot (limits vs current consumption).
export function usageQuery() {
  return queryOptions({
    queryKey: ["usage"] as const,
    queryFn: () => api.getUsage(),
  });
}

// Billing / subscription info.
export function billingQuery() {
  return queryOptions({
    queryKey: ["billing"] as const,
    queryFn: () => api.getBilling(),
  });
}

// Stripe invoices (only meaningful once subscribed — gate with `enabled`).
export function invoicesQuery() {
  return queryOptions({
    queryKey: ["billing", "invoices"] as const,
    queryFn: () => api.getInvoices().then((r) => r.invoices),
  });
}

// Trends summary for a date window. `from`/`to` are computed in the runtime's
// LOCAL timezone (startOfDay/endOfDay) — the server seed runs in the SERVER tz,
// the client's first render in the BROWSER tz. Keying on the full ISO instant
// would make the two diverge for any non-UTC user (guaranteed cache miss). Key
// on the UTC calendar day of each bound instead so server and client produce
// byte-identical keys for the same instant.
export function trendsSummaryQuery(range: { from: Date; to: Date }, productId?: string) {
  const from = range.from.toISOString().slice(0, 10); // UTC yyyy-MM-dd
  const to = range.to.toISOString().slice(0, 10);
  const key = productId
    ? (["trends", "summary", from, to, productId] as const)
    : (["trends", "summary", from, to] as const);
  return queryOptions({
    queryKey: key,
    queryFn: () => api.getTrendsSummary(range, productId),
  });
}

// Cross-competitor market series for the same window. Same UTC-day keying rule as
// the summary above, for the same server-seed/client-render reason.
export function trendsMarketQuery(range: { from: Date; to: Date }, productId?: string) {
  const from = range.from.toISOString().slice(0, 10);
  const to = range.to.toISOString().slice(0, 10);
  const key = productId
    ? (["trends", "market", from, to, productId] as const)
    : (["trends", "market", from, to] as const);
  return queryOptions({
    queryKey: key,
    queryFn: () => api.getTrendsMarket(range, productId),
  });
}

// AI Visibility / "Share of Model" — one query backs the whole page (leaderboard,
// breakdown, trend, prompts). patch-28: scoped to the active product ("you" + its
// competitors); "all products" (no id) uses the primary product's self. Prompts + run
// rows are still org-level, so switching product re-fetches the same prompt set.
export function aiVisibilityQuery(productId?: string) {
  return queryOptions({
    queryKey: productId ? (["ai-visibility", productId] as const) : (["ai-visibility"] as const),
    queryFn: () => api.getAiVisibility(productId),
    // The 403 plan_locked_feature (and any other 4xx) is terminal — retrying it just
    // holds a free/starter user on the loading skeleton through three backoffs before
    // the upsell shows. Retry only transient failures (network / 5xx).
    retry: (failureCount, err) =>
      !(err instanceof ApiError && err.status >= 400 && err.status < 500) && failureCount < 2,
  });
}

// Products settings (the org's SKUs + the plan's product limit). listProducts
// returns { products, plan, limit } together, so one query backs the whole page.
export function productsSettingsQuery() {
  return queryOptions({
    queryKey: ["products", "settings"] as const,
    queryFn: () => api.listProducts(),
  });
}

// Products as a plain list (the compare picker). Distinct key from
// productsSettingsQuery because getCompareData seeds only the products array, not
// the plan/limit that settings carries.
export function productsListQuery() {
  return queryOptions({
    queryKey: ["products", "list"] as const,
    queryFn: () => api.listProducts().then((r) => r.products),
  });
}

// Workspace (general) settings.
export function workspaceSettingsQuery() {
  return queryOptions({
    queryKey: ["workspaceSettings"] as const,
    queryFn: () => api.getWorkspaceSettings(),
  });
}

// The org's own product ("My product"). null when no product site is set yet.
// patch-28 — an optional productId scopes to a given product (the detail page passes
// it). Omitted → the primary self, with the exact same cache key as before (zero
// regression for the existing callers that key on ["myProduct"]).
export function myProductQuery(productId?: string) {
  const key = productId ? (["myProduct", productId] as const) : (["myProduct"] as const);
  return queryOptions({
    queryKey: key,
    queryFn: () => api.getMyProduct(productId).then((r) => r.product),
  });
}

// Pending self-product changes (profile-divergence proposals to review).
export function myProductChangesQuery(productId?: string) {
  const key = productId
    ? (["myProduct", productId, "changes"] as const)
    : (["myProduct", "changes"] as const);
  return queryOptions({
    queryKey: key,
    queryFn: () => api.listMyProductChanges("pending", productId).then((r) => r.changes),
  });
}

// GET /api/products/:id — a product's row + its linked competitors (detail page).
export function productDetailQuery(id: string) {
  return queryOptions({
    queryKey: ["products", "detail", id] as const,
    queryFn: () => api.getProduct(id),
  });
}

// Where a product's entry price sits against its tracked competitors (Pricing tab).
export function productPricingPositionQuery(id: string) {
  return queryOptions({
    queryKey: ["products", "pricing-position", id] as const,
    queryFn: () => api.getProductPricingPosition(id),
  });
}

// Day-0 competitive landscape (Overview cold-start while no signal exists yet).
export function landscapeQuery(productId?: string) {
  return queryOptions({
    queryKey: ["landscape", productId ?? null] as const,
    queryFn: () => api.getLandscape(productId),
  });
}

// AI Visibility onboarding teaser (Lever 7) — poll while the worker computes it, stop
// once the row is terminal (ready | unavailable) so it settles after the day-0 wow.
// Also cap the polling (~15 × 4s ≈ 60s): if a worker hard-kill leaves the terminal row
// unwritten the endpoint returns "pending" forever, so stop hammering it (the component
// hides the card past the same window).
export function aiVisibilityTeaserQuery() {
  return queryOptions({
    queryKey: ["ai-visibility", "teaser"] as const,
    queryFn: () => api.getAiVisibilityTeaser(),
    refetchInterval: (query) =>
      query.state.data?.status === "pending" && query.state.dataUpdateCount < 15 ? 4000 : false,
  });
}

// Sector-trends teaser (top 3) for the Overview section.
export function sectoralTeaserQuery() {
  return queryOptions({
    queryKey: ["sectoral", "teaser"] as const,
    queryFn: () => api.listSectoral({ limit: 3 }).then((r) => r.signals),
  });
}

// Onboarding checklist (Overview card; null/complete hides it).
export function onboardingChecklistQuery() {
  return queryOptions({
    queryKey: ["onboardingChecklist"] as const,
    queryFn: () => api.getOnboardingChecklist(),
  });
}

// Structural-change proposals awaiting a decision (layout banner). Server-seeded so
// the banner doesn't cost a client round-trip on every dashboard page.
export function structuralChangesQuery() {
  return queryOptions({
    queryKey: ["structuralChanges", "detected"] as const,
    queryFn: () => api.getStructuralChanges("detected").then((r) => r.changes),
  });
}

// AI degradation status (layout banner). Server-seeded for the initial paint; the
// banner adds its own refetchInterval to keep polling.
export function aiStatusQuery() {
  return queryOptions({
    queryKey: ["aiStatus"] as const,
    queryFn: () => api.getAiStatus(),
  });
}

// Activity timeline page size — shared so the server seed (limit=25) and the
// client's page-1 key compute the same offset and hit the same cache entry.
export const ACTIVITY_PAGE_SIZE = 25;

// Competitor-discovery candidates for a tab ("new" | "dismissed"), scoped to the
// active product (patch-28). Returns the list + the tab badge counts together.
export function candidatesQuery(status: "new" | "dismissed", productId?: string) {
  return queryOptions({
    queryKey: ["candidates", status, productId ?? null] as const,
    queryFn: () => api.listCandidates(status, productId),
  });
}

// Discovery staleness (tab-independent, per-product) → drives the "already up to
// date" nudge.
export function discoveryStalenessQuery(productId?: string) {
  return queryOptions({
    queryKey: ["discovery", "staleness", productId ?? null] as const,
    queryFn: () => api.getDiscoveryStaleness(productId),
  });
}

// Notification settings (alert channels: Slack / webhook URLs).
export function notificationSettingsQuery() {
  return queryOptions({
    queryKey: ["notificationSettings"] as const,
    queryFn: () => api.getNotificationSettings(),
  });
}

// The org's plan alone (for plan-gating UI). Pulled from billing; a distinct key
// so a {plan}-only server seed doesn't need the full BillingInfo shape.
export function planQuery() {
  return queryOptions({
    queryKey: ["plan"] as const,
    queryFn: () => api.getBilling().then((b) => b.plan),
  });
}

// Notification moderation preferences (channels by severity, quiet hours, cap…).
export function notificationPreferencesQuery() {
  return queryOptions({
    queryKey: ["notificationPreferences"] as const,
    queryFn: () => api.getNotificationPreferences().then((r) => r.preferences),
  });
}

// Auto-tuned relevance threshold (read-only display on the moderation form).
export function relevanceThresholdQuery() {
  return queryOptions({
    queryKey: ["relevanceThreshold"] as const,
    queryFn: () => api.getRelevanceThreshold(),
  });
}

// Activity health = the monitored-source roster + upcoming runs (filter options).
// patch-28 — an optional productId scopes to a product's competitors; omitted keeps
// the ["activity","health"] key (zero regression).
export function activityHealthQuery(productId?: string) {
  const key = productId
    ? (["activity", "health", productId] as const)
    : (["activity", "health"] as const);
  return queryOptions({
    queryKey: key,
    queryFn: () => api.activityHealth(productId),
  });
}

// One page of the activity timeline. Key embeds page + filters; the RSC seeds
// page 1 unfiltered. A URL filter yields a different key → a client fetch, exactly
// like the old hasUrlFilter path.
export function activityTimelineQuery(
  page: number,
  filters: { competitorId?: string; sourceType?: string; status?: ActivityStatusFilter },
  productId?: string,
) {
  const key = productId
    ? (["activity", "timeline", page, filters, productId] as const)
    : (["activity", "timeline", page, filters] as const);
  return queryOptions({
    queryKey: key,
    queryFn: () =>
      api.activityTimeline({
        limit: ACTIVITY_PAGE_SIZE,
        offset: (page - 1) * ACTIVITY_PAGE_SIZE,
        ...filters,
        productId,
      }),
  });
}
