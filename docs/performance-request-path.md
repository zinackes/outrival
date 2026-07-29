# Request-path performance: why a page load was slow

Written 2026-07-29 against `main` @ `66ed3f4`, after "pages and tabs take a long
time to load, and every uncached fetch is slow" (prod, outrival.app).

The short version: nothing was slow on its own. One navigation asked the same
questions many times over, and every repetition was charged in full.

## What a dashboard navigation actually cost

A single page render fires **8 to 14 server-side API calls**:

| Caller | Calls |
|---|---|
| `dashboard/layout.tsx` gate | `/api/auth/get-session` |
| `dashboard/layout.tsx` | `/api/onboarding/status`, `/api/billing?summary=1`, `/api/onboarding-session/current` |
| `getShellData` | `/api/products`, `/api/structural-changes`, `/api/system/ai-status` |
| the page's own seed | 1-7 more (Overview alone: signals, competitors, sectoral, battle-cards, checklist, activity health, digests) |

Each of those calls then paid, in order:

1. **A full internet round trip to reach a container on the same host.** Server-side
   fetches used `NEXT_PUBLIC_API_URL` = `https://api.outrival.io`, which is
   Cloudflare-proxied. So the Next container went out to the edge and came back in
   through Traefik, 8 to 14 times per navigation.
2. **Three database round-trips before the handler ran**: Better Auth reads the
   session row, then the user row, then `authMiddleware` reads our own `users`
   mirror for the suspension flag and `orgId`. Nothing about that answer can change
   between two fetches of the same page, and it was recomputed for every one.
3. **The handler's own queries, issued one at a time.** The competitor roster made
   nine sequential reads that no ordering required. `buildOverview` (competitor
   detail) made eight. The products list, fetched by the shell on *every*
   navigation, made seven. The signals facets bar made three.

Then the sidebar, which mounts on every page, had no server seed, so after
hydration the browser fetched the heaviest endpoint in the API by itself and the
roster stayed empty through the entire first paint.

## Measured costs

From this machine against a Neon branch (`/health/ready` is one `SELECT 1`):

| | |
|---|---|
| Warm DB round trip | **19 ms** |
| First query after idle (connect + Neon wake) | **899 ms** |

At 19 ms a round trip, the per-request auth alone was ~57 ms, the competitor roster
~190 ms of pure waiting, `buildOverview` ~152 ms. Multiply the auth cost by 8-14
calls and a page spent the better part of a second re-authenticating itself.

The 899 ms figure is the answer to "the FIRST load is the slow one". Neon
autosuspends its compute after ~5 minutes idle. Between hourly cron fires and an
idle app, most sessions open onto a suspended compute and pay the wake before
anything else happens.

## What changed (branch `perf/request-path-latency`)

- **`INTERNAL_API_URL`** (`apps/web/src/lib/api-base.ts`): the address the Next
  *server* uses for the API. Unset, it falls back to the public URL and nothing
  changes; set to the API's container address, the Cloudflare hairpin disappears
  from all 8-14 calls. Server-only by design: a `NEXT_PUBLIC_` name would be
  inlined into the browser bundle, which cannot resolve a container address.
- **Session cache in `authMiddleware`**, keyed by session token, 30s TTL
  (`SESSION_CACHE_TTL_MS`, `0` disables). Collapses three DB round-trips per
  authenticated call to one lookup per session per window. The trade is revocation
  freshness: a sign-out on *another* device, or an operator suspension, takes effect
  up to the TTL later. Signing out on the device itself is unaffected, because the
  cookie is gone and nothing can reach the entry.
- **Parallelised the independent reads** in `GET /api/competitors` (9 sequential →
  3 waves), `buildOverview` (8 → 1), `GET /api/products` (7 → 2) and
  `GET /api/signals/facets` (3 → 1). No query changed; only the ordering nothing
  required.
- **The sidebar roster is seeded by the layout**, using the same query string as the page
  seeds, so `React.cache` collapses both into one round trip per render.
- **Response compression** (`hono/compress`). Cloudflare compresses edge→browser but
  fetches from the origin raw, and a signals page carries insight + soWhat +
  recommendedAction + narrative per row. SSE is untouched: the middleware's
  content-type filter excludes `text/event-stream`.
- **`Server-Timing: api;dur=…` on every response.** The API runs on Bun, where
  `@sentry/node`'s HTTP auto-instrumentation never attaches, so there was no
  server-side timing anywhere, which is why this had to be reasoned about rather
  than read.

## What is left, ranked

1. **Neon autosuspend, the 899 ms first load.** Not a code problem: raise or disable
   autosuspend in the Neon console, or accept it. Keeping the compute awake bills
   compute-hours around the clock, so it is a cost decision, not a default. Nothing
   else on this list moves the first-load number as much.
2. **The layout's session gate still bypasses the cache.** `/api/auth/get-session`
   goes to Better Auth's own handler, not through `authMiddleware`, so it still costs
   two DB reads and one extra sequential wave on every navigation. Serving the gate
   from an endpoint behind `authMiddleware` would make it nearly free. Deferred on
   purpose: this is the code with the `/auth` ↔ `/dashboard` redirect-flap history,
   and the three-state outcome (`authenticated` / `unauthenticated` /
   `indeterminate`) must survive the change exactly. Better Auth's own
   `session.cookieCache` is the other route, but in stateful mode it is a login-time
   read-through only and carries open reports of premature logouts.
3. **Client cache across navigations.** TanStack Query holds nothing between reloads,
   so a returning user re-fetches everything. Persisting the cache would make
   revisits paint instantly; it also puts org data in `localStorage`, which is a
   product decision on shared machines.
4. **Poll load.** An open tab polls `/api/competitors` (30s), signals (30s ×2),
   landscape (30s), overview (60s ×2) and AI status. Each is much cheaper now, but
   the count is worth revisiting.
5. **Cache Components / PPR (Next 16).** `cacheComponents: true` would let the shell
   prerender and stream the dynamic parts. It is a migration, not a switch: `use
   cache` keys on arguments and is shared across users, so every cached unit has to
   carry the org id explicitly or it leaks across tenants.

## How to measure it

**Is the internal hop live?** From inside the web container:

```
curl -sS -o /dev/null -w '%{http_code} %{time_total}\n' http://api:3001/health
```

**Where does a page's time go?** Open the dashboard with DevTools → Network. Each API
row now carries `Server-Timing: api;dur=N` (Timing tab). `N` is the API's own time;
the rest of the row is network. Before/after on the same page is the honest test.

**Is the database cold?** Against any environment:

```
curl -sS -o /dev/null -w '%{time_total}\n' https://api.outrival.io/health/ready   # first
curl -sS -o /dev/null -w '%{time_total}\n' https://api.outrival.io/health/ready   # warm
```

A first call an order of magnitude slower than the second is the autosuspend wake,
not the app.
