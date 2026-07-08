# Plan 013: Make the Trends SSR prefetch key timezone-stable so the seed isn't discarded

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result. If anything in "STOP conditions" occurs,
> stop and report. When done, update this plan's row in `plans/README.md` unless a
> reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 81c4b75..HEAD -- apps/web/src/lib/queries.ts apps/web/src/lib/api-server.ts apps/web/src/components/ui/date-range-picker.tsx`
> If any changed, compare against "Current state" before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

The Trends page prefetches its data on the server and dehydrates it into the TanStack
cache under a query key built from `range.from.toISOString()` / `range.to.toISOString()`.
But `from`/`to` come from `startOfDay`/`endOfDay` (date-fns), which resolve in the runtime's
**local** timezone. The server seed computes them in the **server** timezone; the client's
first render computes them in the **browser** timezone. For any user whose timezone ≠ the
server's (i.e. essentially every non-UTC user), the two `.toISOString()` values differ, so
the client requests a key the server never stored → guaranteed cache miss → the client
refetches `/api/trends/summary`, which runs four heavy analytics queries. The server's
prefetch work is wasted on every Trends load. A code comment claims both are "rounded to
the day" and hit the same entry — the code has drifted from that comment. Fix: key on
date-only bounds so server and client produce byte-identical keys.

## Current state

- **The query key** — `apps/web/src/lib/queries.ts:138-151`:
  ```ts
  // "...both rounded to the day — hit the same cache entry."  ← stale comment
  export function trendsSummaryQuery(range: { from: Date; to: Date }, productId?: string) {
    const from = range.from.toISOString();   // full ISO instant — TZ-dependent
    const to = range.to.toISOString();
    const key = productId
      ? (["trends", "summary", from, to, productId] as const)
      : (["trends", "summary", from, to] as const);
    return queryOptions({ queryKey: key, queryFn: () => api.getTrendsSummary(range, productId) });
  }
  ```
- **Client range source** — `apps/web/src/components/ui/date-range-picker.tsx:24-26`:
  ```ts
  export function lastNDays(n: number): DateRange {
    return { from: startOfDay(subDays(new Date(), n)), to: endOfDay(new Date()) };  // LOCAL tz
  }
  ```
- **Server seed** — `apps/web/src/lib/api-server.ts:237-243`:
  ```ts
  const from = startOfDay(subDays(new Date(), 90));   // SERVER tz
  const to = endOfDay(new Date());
  const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  ...
  ```
  This seed is dehydrated under the key `trendsSummaryQuery` produces from the same
  `from`/`to` — so if the key embeds the full instant, server-tz vs client-tz diverge.
- The API endpoint `/api/trends/summary` (`apps/api/src/routes/trends.ts`) accepts `from`/`to`
  query params and runs 4 windowed/`DISTINCT ON` analytics scans.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0 |
| Web unit tests | `pnpm --filter @outrival/web test` | pass (incl. new key test if added) |

## Scope

**In scope**:
- `apps/web/src/lib/queries.ts` — normalize the key to date-only bounds.

**Out of scope**:
- `api-server.ts` / `date-range-picker.tsx` — do NOT change how ranges are computed; only
  the **key derivation** in `queries.ts` needs to be timezone-stable. (Changing the range
  math risks shifting the actual data window; the fix is purely in the cache key.)
- The API endpoint and its queries — unchanged.
- The `queryFn` — still passes the real `range` (Date objects) to `api.getTrendsSummary`;
  only the **key** changes.

## Git workflow

- Branch: `advisor/013-trends-tz-key`
- One commit, conventional: `perf(web): key trends prefetch on date-only bounds`.
- Do NOT push unless instructed.

## Steps

### Step 1: Derive the key from date-only, timezone-stable bounds

The subtlety: `format(date, "yyyy-MM-dd")` also uses local time, so it would **not** fix the
mismatch (server vs client still differ at the day boundary). To be byte-identical across
timezones, derive the day bucket from the **UTC** calendar date of each bound. Use each
Date's UTC year/month/day (e.g. `date.toISOString().slice(0, 10)` gives the UTC `yyyy-MM-dd`),
so server and client produce the same string for the same instant:

```ts
export function trendsSummaryQuery(range: { from: Date; to: Date }, productId?: string) {
  // Key on the UTC calendar day of each bound so the server seed (server-tz Dates) and the
  // client's lastNDays() (browser-tz Dates) produce byte-identical keys — otherwise the
  // dehydrated seed is stored under a key the client never requests (guaranteed cache miss).
  const from = range.from.toISOString().slice(0, 10);  // UTC yyyy-MM-dd
  const to = range.to.toISOString().slice(0, 10);
  const key = productId
    ? (["trends", "summary", from, to, productId] as const)
    : (["trends", "summary", from, to] as const);
  return queryOptions({ queryKey: key, queryFn: () => api.getTrendsSummary(range, productId) });
}
```

Remove the stale "both rounded to the day" comment (replace with the accurate one above).

**Note on the residual edge**: `startOfDay`/`endOfDay` in a non-UTC zone can still land on a
different UTC calendar day than the server for the same "last 90 days" intent (e.g. late-
evening local time). This fix makes the **common** case (users in the same UTC day as the
server at request time) hit the cache, which is the vast majority; it does not attempt to
unify the underlying window math (out of scope). If the operator wants a guaranteed match,
the follow-up is to compute the window from explicit UTC day boundaries on **both** the
server seed and the client's first render — noted in Maintenance.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Lock the behavior with a unit test

Add a test (under `apps/web/test/`, following `apps/web/test/format-tier-price.test.ts`)
that constructs two `Date` objects representing the **same instant** and asserts
`trendsSummaryQuery(range).queryKey` is identical regardless of how the Dates were built,
and that a `from`/`to` pair maps to the expected UTC `yyyy-MM-dd` strings. If `queries.ts`
imports are hard to isolate for a unit test, extract a tiny pure helper
`trendsDayKey(from: Date, to: Date, productId?)` and test that.

**Verify**: `pnpm --filter @outrival/web test` → all pass.

## Test plan

- New unit test asserting key stability across timezone-equivalent Dates and correct
  UTC-day derivation (Step 2). This is the regression guard — the whole bug is a key
  mismatch, so a key-equality test is exactly the right coverage.
- Verification: `pnpm --filter @outrival/web test` passes; `pnpm typecheck` exits 0.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `trendsSummaryQuery` keys on UTC `yyyy-MM-dd` bounds (no full-instant `.toISOString()`)
- [ ] A unit test asserts key equality for the same instant + correct UTC-day strings
- [ ] `pnpm --filter @outrival/web test` passes
- [ ] Only `queries.ts` (+ the new test, + optional extracted helper) changed (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- The server seed (`api-server.ts`) turns out to dehydrate under a **different** key
  construction than `trendsSummaryQuery` (so this fix wouldn't align them) — report the
  actual dehydration key; the fix must match wherever the seed is stored.
- Other callers of `trendsSummaryQuery` pass ranges that are not day-aligned (e.g. an
  arbitrary custom range with intraday bounds) and would now collide under a day-only key —
  report; day-granularity is correct for this data but confirm no caller needs finer keys.

## Maintenance notes

- Full correctness (guaranteed cross-timezone match) requires computing the 90-day window
  from explicit UTC day boundaries on both the server seed and the client's first render —
  a small follow-up if cache-hit telemetry shows residual misses.
- Reviewer should confirm the `queryFn` still receives the real `range` Dates (only the key
  changed) so the API still gets precise `from`/`to` params.
