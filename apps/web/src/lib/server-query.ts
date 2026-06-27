import { QueryClient } from "@tanstack/react-query";

/**
 * Fresh `QueryClient` for server-side seeding inside a Server Component. Make one
 * **per request**, seed it (`setQueryData` / `prefetchQuery`), `dehydrate` it into
 * a `<HydrationBoundary>`, then drop it — never share a client across requests, or
 * one user's data leaks into another's. The long-lived browser client lives in
 * `components/query-provider.tsx`. See docs/tanstack-query.md.
 */
export function makeServerQueryClient() {
  return new QueryClient({
    // Match the browser default so hydrated data isn't instantly stale → no
    // refetch on mount.
    defaultOptions: { queries: { staleTime: 60_000 } },
  });
}
