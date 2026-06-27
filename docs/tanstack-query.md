# TanStack Query — data fetching in `@outrival/web`

Reference for how the web app uses TanStack Query (React Query v5), how far the
server-side story goes, and the rules for migrating the rest of the app.

- **Versions**: `@tanstack/react-query` 5.x · Next.js 16 App Router · React 19.
- **Status**: **client-only pilot**. Introduced to kill the per-tab skeleton flash
  on the competitor detail page (`pricing` / `hiring` / `reviews` tabs). The rest
  of the app still self-fetches with `useState` + `useEffect`; those migrate
  incrementally (see [Roadmap](#incremental-migration-roadmap)).

---

## 1. Why we adopted it

The convention was always *"TanStack Query in Client Components"* (`apps/web/CLAUDE.md`),
but real usage was zero — ~39 client components hand-rolled `useState`/`useEffect`
fetches. Symptom that forced the issue: Radix `TabsContent` **unmounts** inactive
tabs, so every self-fetching tab remounted to `data = null` → skeleton → refetch
on every tab switch, with **no cache**.

TanStack Query gives us, at app scale (not on 3 tabs):

- a **shared cache** — the same `queryKey` is served instantly across remounts and
  across components (a sidebar counter and a page can dedupe one request);
- **centralized invalidation** (`queryClient.invalidateQueries`) instead of ad-hoc
  `refreshTick` props;
- background refetch, retry, normalized `isPending` / `isError` states;
- a first-class **server prefetch → hydration** path for App Router (section 4).

---

## 2. Current setup

`src/components/query-provider.tsx` — a Client Component that creates **one
`QueryClient` per browser tab** via `useState` (never at module scope, so SSR
never shares a client across requests). Mounted in `app/layout.tsx`, wrapping the
whole app.

```tsx
// src/components/query-provider.tsx
const [client] = useState(
  () =>
    new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60_000,          // hydrated/cached data is "fresh" for 60s → no
                                       // refetch on remount, no flash on tab re-switch
          refetchOnWindowFocus: false, // the dashboard polls scrapes explicitly
        },
      },
    }),
);
```

`staleTime: 60_000` is the load-bearing default — with the v5 default of `0`,
data is stale on arrival and refetches immediately, defeating both the cache and
(later) server hydration.

---

## 3. Client usage pattern

Replace a `useState(null)` + `useEffect(fetch)` block with `useQuery`. The three
piloted tabs follow this shape:

```tsx
import { useQuery, keepPreviousData } from "@tanstack/react-query";

const jobsQuery = useQuery({
  queryKey: ["competitor", competitorId, "jobs", refreshTick],
  queryFn: () => api.getCompetitorJobs(competitorId),
  placeholderData: keepPreviousData,
});
const jobs = jobsQuery.data ?? null;
if (jobsQuery.isError) return <Empty … />;
if (!jobs) return <TabLoading />;
```

Two deliberate choices:

- **`refreshTick` in the `queryKey`.** The parent still bumps `refreshTick` after a
  forced re-scan to invalidate; folding it into the key was the smallest change
  (zero parent edits). When more of the app moves onto Query, replace this with
  `queryClient.invalidateQueries({ queryKey: ["competitor", id] })`.
- **`placeholderData: keepPreviousData`.** On a key change (post-scrape) the
  previous result stays on screen during the refetch → no empty skeleton. On a
  plain remount (tab re-switch) the shared cache already serves the data, so a
  skeleton only ever shows on the genuine first load.

### queryKey conventions

Hierarchical, most-general → most-specific, so partial invalidation works:

```
["competitor", competitorId, <slice>, …]   // "jobs", "pricingHistory", "reviews", "reviewScores"
["myProduct"]                                // org-wide singletons
```

Invalidating `["competitor", id]` drops every slice of one competitor;
`["competitor", id, "jobs"]` drops just hiring.

---

## 4. Server-side prefetch + hydration (App Router)

**Yes, TanStack Query has a first-class server story** and it's the recommended
App Router pattern. We are **not using it yet** — the pilot is client-only. Here
is how it works and, importantly, **how far it's worth taking in our case**.

### The pattern

A Server Component prefetches into a throwaway server `QueryClient`, dehydrates it,
and wraps the client subtree in `<HydrationBoundary>`. The client `useQuery` then
reads the hydrated cache instead of fetching:

```tsx
// app/.../page.tsx  (Server Component)
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";

export default async function Page() {
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({
    queryKey: ["competitor", id, "jobs"],   // MUST match the client key byte-for-byte
    queryFn: () => getCompetitorJobsServer(id), // server fn (cookie-forwarded, see §5)
  });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <HiringTab competitorId={id} … />       {/* its useQuery is now hydrated → no client fetch */}
    </HydrationBoundary>
  );
}
```

Key rules:

- **The contract is the `queryKey`** — the client must call `useQuery` with the
  exact same key it was prefetched under, or it refetches.
- **`staleTime > 0` is mandatory** (we have 60s globally) or the client refetches
  on hydration and the prefetch was wasted.
- The browser provider from §2 stays as-is — `HydrationBoundary` injects the
  dehydrated state into the existing per-tab client. **No provider refactor is
  needed to start prefetching.** A shared `getQueryClient()` factory (server =
  fresh per request, browser = singleton) only becomes necessary for *streaming*
  (below) or to share one server client across several Server Components via
  React `cache()`.

### Streaming (deferred)

For slow endpoints you can skip `await` on `prefetchQuery`, dehydrate the *pending*
query (override `shouldDehydrateQuery` to include `status === "pending"`), wrap in
`<Suspense>`, and use `useSuspenseQuery` on the client — data streams in as it
resolves. Requires `@tanstack/react-query-next-experimental`
(`ReactQueryStreamedHydration`). **Not adopted** — our reads are fast and the
non-streaming prefetch above covers the need.

---

## 5. Relationship to the existing server prefetch (`lib/api-server.ts`)

We already have a **home-grown server prefetch**: `lib/api-server.ts` exposes RSC
functions that `fetch(API_BASE + path, { headers: cookie })` (forwarding the Better
Auth session cookie), and pages pass the result as an `initialData` prop. Example:
`competitors/[id]/page.tsx` → `getCompetitorDetailData(id)` → `<CompetitorDetailView
initialData={…} />`, where the client view seeds `useState` from it and skips its
first client fetch.

This is conceptually the same thing as Query hydration, done by hand. The two
**coexist** during migration, and `api-server.ts` is the natural **server queryFn**
when a page moves to hydration:

```
Today (seed-props):   RSC api-server.ts → initialData prop → useState(initialData)
Hydration (target):   RSC api-server.ts → prefetchQuery → dehydrate → HydrationBoundary → useQuery(sameKey)
```

When converging a page, reuse the existing `api-server.ts` function as the
`queryFn` inside `prefetchQuery`, and the client `lib/api.ts` call as the browser
`queryFn`, under one shared `queryKey`. Don't rip out `api-server.ts` — it's the
cookie-forwarding server fetch layer either way.

---

## 6. When **not** to prefetch on the server

Server prefetch is for **critical, stable, above-the-fold** data on first paint.
Skip it (client-only `useQuery` is correct) when:

- the data backs a **secondary / on-demand view** — e.g. the competitor tabs:
  prefetching all of pricing+hiring+reviews on page render would fire requests for
  tabs the user may never open. The pilot is deliberately client-only here.
- a brief **loading state is acceptable**;
- the data **changes often** (prefetched value is stale immediately);
- the `queryFn` would call a **Server Action** — they run serially and fight
  Query's parallel fetch model. Use the route-handler / API layer (`api-server.ts`).

---

## 7. Incremental migration roadmap

Not a big-bang. ~39 client components still self-fetch; migrate **when you touch a
zone**, not as a sweep (the app can't be fully exercised locally — WSL2 RAM).

Per zone:

1. Client component: `useState`/`useEffect` fetch → `useQuery` (§3), hierarchical key.
2. Drop the now-dead `refreshTick`-style props in favor of `invalidateQueries`
   once the parent is also on Query.
3. If the data is first-paint-critical: add `prefetchQuery` + `HydrationBoundary`
   in the RSC page (§4), reusing `api-server.ts` as the server `queryFn` (§5).

Provider refactor to a shared `getQueryClient()` factory is only required if/when
we adopt streaming — track it then, not now.
