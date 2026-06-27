import { queryOptions } from "@tanstack/react-query";
import { api } from "./api";

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
