# TanStack Query — data fetching in `@outrival/web`

Reference for how the web app uses TanStack Query (React Query v5), how far the
server-side story goes, and the rules for migrating the rest of the app.

- **Versions**: `@tanstack/react-query` 5.x · Next.js 16 App Router · React 19.
- **Status**: **adopted app-wide**. It started as a pilot on the competitor detail
  tabs (`pricing` / `hiring` / `reviews`) to kill the per-tab skeleton flash, then
  generalized: 101 files under `apps/web/src` use a Query hook, 55 key factories
  live in `src/lib/queries.ts`, and 23 RSC pages hydrate a server-seeded cache. Ten
  client components still hand-roll `useState` + `useEffect` + `api.*` (see
  [Roadmap](#incremental-migration-roadmap)).

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
          retry: shouldRetryQuery,     // 4xx is final → surface it on the first answer
        },
      },
    }),
);
```

`staleTime: 60_000` is the load-bearing default — with the v5 default of `0`, data
is stale on arrival and refetches immediately, defeating both the cache and server
hydration. `retry: shouldRetryQuery` (`lib/error-helpers.ts`) is the other one: v5
retries everything three times, so a stale id fired the same 404 four times before
the screen said anything.

---

## 3. Client usage pattern

**Never write a `queryKey` inline.** Every endpoint gets one `queryOptions` factory
in `src/lib/queries.ts` (55 today), and both sides call it — the client `useQuery`
and the RSC that seeds the cache (§4). The key is the hydration contract, so a
retyped array that drifts by one element hydrates nothing, silently:

```tsx
// src/lib/queries.ts
export function productsSettingsQuery() {
  return queryOptions({
    queryKey: ["products", "settings"] as const,
    queryFn: () => api.listProducts(),
  });
}

// the client component
const productsQ = useQuery(productsSettingsQuery());
const products = productsQ.data?.products ?? null;
if (productsQ.isError) return <Empty … />;
if (!products) return <TabLoading />;
```

Paginated endpoints use `infiniteQueryOptions` in the same file (`signalsFeedQuery`,
`activityFeedQuery`) so the SSR seed of page 1 and the client's first page land on
one cache entry.

`placeholderData: keepPreviousData` on a filter-bearing key keeps the previous result
on screen during the refetch → no empty skeleton on a filter change. On a plain
remount the shared cache already serves the data, so a skeleton only shows on a
genuine first load.

### queryKey conventions

Hierarchical, most-general → most-specific, so partial invalidation works. Params go
in the key as an object — TanStack hashes it stably, so seed and read need equal
params, not the same object identity:

```
["competitor", competitorId, <slice>]   // "detail", "battleCardStaleness", …
["signals", { limit, productId, sort }]   // params embedded → distinct cache entries
["products", "settings"]                  // org-wide singletons
```

Invalidating `["competitor", id]` drops every slice of one competitor;
`["signals"]` drops the feed, its pages and its facets.

---

## 4. Server-side prefetch + hydration (App Router)

**Yes, TanStack Query has a first-class server story** and it's the recommended
App Router pattern. It is now the default for first-paint data: 23 RSC pages seed a
per-request client and hand it down through `<HydrationBoundary>`.

### The pattern

A Server Component builds a throwaway server `QueryClient` via
`makeServerQueryClient()` (`src/lib/server-query.ts` — never `new QueryClient()`
inline, and never one shared across requests), seeds it, dehydrates it, and wraps
the client subtree. The client `useQuery` then reads the hydrated cache instead of
fetching:

```tsx
// app/dashboard/products/page.tsx  (Server Component)
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { makeServerQueryClient } from "@/lib/server-query";

export default async function Page() {
  const list = await getProductsList();          // api-server.ts, cookie-forwarded (§5)
  const queryClient = makeServerQueryClient();
  queryClient.setQueryData(productsSettingsQuery().queryKey, list);
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProductsPortfolio />                       {/* its useQuery is hydrated → no client fetch */}
    </HydrationBoundary>
  );
}
```

We seed with `setQueryData` off an already-awaited `api-server.ts` call rather than
`prefetchQuery`: the page needs the payload itself (gating, `notFound()`, metadata),
so fetching it twice — once for the page, once through a `queryFn` — would double the
round trip. `prefetchQuery` is the right call when only the client subtree reads it.

Key rules:

- **The contract is the `queryKey`** — the client must call `useQuery` with the
  exact same key the server seeded, which is why both sides go through the factory
  in `lib/queries.ts` (§3).
- **`staleTime > 0` is mandatory** (we have 60s globally) or the client refetches
  on hydration and the seed was wasted.
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

## 5. The RSC fetch layer (`lib/api-server.ts`)

`lib/api-server.ts` is the RSC fetch layer: functions that
`fetch(API_BASE + path, { headers: cookie })`, forwarding the Better Auth session
cookie. It predates Query — pages used to pass its result down as an `initialData`
prop and the client view seeded `useState` from it.

The seed-props step is **done** — no `initialData` prop is left in `apps/web/src`.
What survives, and should, is `api-server.ts` itself: 25 RSC files still call it, now
as the source of the value they seed into the hydrated cache.

```
Before:   RSC api-server.ts → initialData prop → useState(initialData)
Now:      RSC api-server.ts → setQueryData(sameKey) → dehydrate → HydrationBoundary → useQuery(sameKey)
```

The `queryKey` is the contract on both sides, so take it from the factory in
`lib/queries.ts` (`productsSettingsQuery().queryKey`) rather than retyping the array
— a hand-written key that drifts by one element hydrates nothing and fails silently.

---

## 6. When **not** to prefetch on the server

Server prefetch is for **critical, stable, above-the-fold** data on first paint.
Skip it (client-only `useQuery` is correct) when:

- the data backs a **secondary / on-demand view** — e.g. the competitor tabs:
  prefetching all of pricing+hiring+reviews on page render would fire requests for
  tabs the user may never open. These stay deliberately client-only.
- a brief **loading state is acceptable**;
- the data **changes often** (prefetched value is stale immediately);
- the `queryFn` would call a **Server Action** — they run serially and fight
  Query's parallel fetch model. Use the route-handler / API layer (`api-server.ts`).

---

## 7. Incremental migration roadmap

Nearly done, and never a big-bang. Ten client components still hand-roll
`useState` + `useEffect` + `api.*`; migrate **when you touch a zone**, not as a
sweep (the app can't be fully exercised locally — WSL2 RAM).

Per zone:

1. Client component: `useState`/`useEffect` fetch → `useQuery` (§3), hierarchical key.
2. Drop the now-dead `refreshTick`-style props in favor of `invalidateQueries`
   once the parent is also on Query.
3. If the data is first-paint-critical: seed `makeServerQueryClient()` +
   `HydrationBoundary` in the RSC page (§4), off the `api-server.ts` call the page
   already awaits (§5).

Provider refactor to a shared `getQueryClient()` factory is only required if/when
we adopt streaming — track it then, not now.

---

## 8. Intentionally NOT on useQuery

useQuery is a tool, not a mandate — a handful of components keep `useState`/`useEffect`
because the pattern doesn't fit or adds no value:

- **`ask-panel`** — the answer is an **SSE stream**, not a cacheable GET. (Its chat
  history could be a `useQuery`, but it's a thin one-shot read; left as-is.)
- **`sectoral-feed`** (`/dashboard/sector`) — an **infinite-scroll list** (`loadMore`
  appends pages). The right tool is `useInfiniteQuery`, a separate refactor; for a
  secondary page the rolling `useState` list is fine. (It *also* has a seed-props
  path — a Phase-A item — so if it's ever converged, do it as `useInfiniteQuery` +
  hydration of page 1.)
- **`update-profile-dialog`** — a fetch-on-open that seeds **~10 editable draft
  fields** from two endpoints. One-shot form init, no cache to share, no re-render on
  data → a plain effect is clearer than `useQuery` + a seed effect.
- **`nps-prompt`** (one-shot eligibility gate) and **`feedback-widget`** (no GET) —
  nothing to cache.

Rule of thumb: migrate when useQuery buys a shared cache, dedupe, hydration, or
declarative refetch. Skip when it's a stream, an infinite list (use `useInfiniteQuery`),
a one-shot form-init, or a bespoke poll loop.
