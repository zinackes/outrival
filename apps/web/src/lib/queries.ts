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

// Org competitor roster (with per-competitor stats).
export function competitorsQuery() {
  return queryOptions({
    queryKey: ["competitors"] as const,
    queryFn: () => api.listCompetitors().then((r) => r.competitors),
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
export function trendsSummaryQuery(range: { from: Date; to: Date }) {
  return queryOptions({
    queryKey: ["trends", "summary", range.from.toISOString(), range.to.toISOString()] as const,
    queryFn: () => api.getTrendsSummary(range),
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
export function myProductQuery() {
  return queryOptions({
    queryKey: ["myProduct"] as const,
    queryFn: () => api.getMyProduct().then((r) => r.product),
  });
}

// Pending self-product changes (profile-divergence proposals to review).
export function myProductChangesQuery() {
  return queryOptions({
    queryKey: ["myProduct", "changes"] as const,
    queryFn: () => api.listMyProductChanges("pending").then((r) => r.changes),
  });
}

// Activity timeline page size — shared so the server seed (limit=25) and the
// client's page-1 key compute the same offset and hit the same cache entry.
export const ACTIVITY_PAGE_SIZE = 25;

// Competitor-discovery candidates for a tab ("new" | "dismissed"). Returns the
// list + the tab badge counts together.
export function candidatesQuery(status: "new" | "dismissed") {
  return queryOptions({
    queryKey: ["candidates", status] as const,
    queryFn: () => api.listCandidates(status),
  });
}

// Discovery staleness (tab-independent) → drives the "already up to date" nudge.
export function discoveryStalenessQuery() {
  return queryOptions({
    queryKey: ["discovery", "staleness"] as const,
    queryFn: () => api.getDiscoveryStaleness(),
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
export function activityHealthQuery() {
  return queryOptions({
    queryKey: ["activity", "health"] as const,
    queryFn: () => api.activityHealth(),
  });
}

// One page of the activity timeline. Key embeds page + filters; the RSC seeds
// page 1 unfiltered. A URL filter yields a different key → a client fetch, exactly
// like the old hasUrlFilter path.
export function activityTimelineQuery(
  page: number,
  filters: { competitorId?: string; sourceType?: string; status?: ActivityStatusFilter },
) {
  return queryOptions({
    queryKey: ["activity", "timeline", page, filters] as const,
    queryFn: () =>
      api.activityTimeline({
        limit: ACTIVITY_PAGE_SIZE,
        offset: (page - 1) * ACTIVITY_PAGE_SIZE,
        ...filters,
      }),
  });
}
