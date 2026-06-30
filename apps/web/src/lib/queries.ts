import { queryOptions } from "@tanstack/react-query";
import { api, type ActivityStatusFilter } from "./api";

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

// Full competitor detail (the [id] page: competitor + monitors + recent changes/
// signals + tech stack + overview + plan). Distinct ["competitor", id, "detail"]
// key from the per-tab queries (["competitor", id, "jobs"|"pricingHistory"|…]).
export function competitorDetailQuery(id: string) {
  return queryOptions({
    queryKey: ["competitor", id, "detail"] as const,
    queryFn: () => api.getCompetitor(id),
  });
}

// Weekly digests list.
export function digestsQuery() {
  return queryOptions({
    queryKey: ["digests"] as const,
    queryFn: () => api.listDigests().then((r) => r.digests),
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

// Trends summary for a date window. The key embeds the ISO bounds so the server
// seed (default 90d) and the client's lastNDays(90) — both rounded to the day —
// hit the same cache entry.
export function trendsSummaryQuery(range: { from: Date; to: Date }, productId?: string) {
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  const key = productId
    ? (["trends", "summary", from, to, productId] as const)
    : (["trends", "summary", from, to] as const);
  return queryOptions({
    queryKey: key,
    queryFn: () => api.getTrendsSummary(range, productId),
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
