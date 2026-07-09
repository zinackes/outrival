# Plan 011: Collapse the onboarding analysis poll storm into one self-terminating query

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result. If anything in "STOP conditions" occurs,
> stop and report. When done, update this plan's row in `plans/README.md` unless a
> reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 81c4b75..HEAD -- apps/web/src/hooks/use-onboarding-streaming.ts apps/web/src/components/dashboard/overview.tsx apps/web/src/lib/queries.ts`
> If any changed, compare against "Current state" before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW–MED (behavior-preserving refactor of a polling flow)
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

For the first ~10 minutes of every new org (exactly when the backend is also scraping and
running that org's AI analysis), the dashboard hammers its two most expensive endpoints
~3×/3s: the onboarding hook calls `api.listCompetitors()` every 3s (bypassing the
TanStack cache) **and** fires `onTick`, which refetches the competitors roster **again**
plus a ~100 KB, 200-row signals payload. None of it gates on tab visibility, so it keeps
running on a backgrounded tab. That's a duplicate roster fetch + a 100 KB signals refetch
every 3 seconds. This plan drives the panel from a single cached, self-terminating query.

## Current state

- **The hook** — `apps/web/src/hooks/use-onboarding-streaming.ts`:
  - `POLL_MS = 3000`, `SAFETY_MS = 10 * 60 * 1000`.
  - `poll()` calls `const { competitors } = await api.listCompetitors();` (raw, uncached),
    then `onTickRef.current?.();`, derives `{ total, analyzed }` from `c.aiSummary != null`,
    fires `first_signal_received` / `analysis_completed` once, and `stop()`s when
    `analyzed >= total`.
  - Runs on a `setInterval(() => void poll(), POLL_MS)` bounded only by `SAFETY_MS`.
  - No `document.visibilityState` gate.
- **The `onTick` it drives** — `apps/web/src/components/dashboard/overview.tsx:125-135`:
  ```ts
  const load = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: signalsQuery({ limit: 200, productId }).queryKey });
    void queryClient.refetchQueries({ queryKey: competitorsQuery(productId).queryKey });
  }, [queryClient, productId]);
  const analysis = useOnboardingStreaming(load);
  ```
  So each 3s tick = `listCompetitors()` (hook) + refetch competitors (load) + refetch
  signals-200 (load). `overview.tsx:99-100` also keeps `signalsQuery({limit:200})` and
  `competitorsQuery` on an always-on `refetchInterval: 60_000`.
- `competitorsQuery(productId)` and `signalsQuery({limit,productId})` are defined in
  `apps/web/src/lib/queries.ts` (TanStack `queryOptions`). The competitors query returns
  the same roster the hook reads (`aiSummary` is present on each row).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0 |
| Web tests (if any touch this) | `pnpm --filter @outrival/web test` | pass |

Note: the WSL2 dev host cannot run `next build`/`next dev` (OOM) — `pnpm typecheck` is the
gate. Do not attempt a dev-server visual check locally.

## Scope

**In scope**:
- `apps/web/src/hooks/use-onboarding-streaming.ts`
- `apps/web/src/components/dashboard/overview.tsx` (the `load` callback + how the hook is wired)

**Out of scope**:
- The onboarding backend / job pipeline.
- The always-on 60s `refetchInterval` on the overview's own queries — leave it; this plan
  is about the 3s onboarding storm, not the steady-state 60s poll. (You may note it for a
  later pass but do not change it here.)
- `queries.ts` query definitions — reuse them; do not restructure the key factory.

## Git workflow

- Branch: `advisor/011-onboarding-poll-storm`
- One commit, conventional: `perf(web): collapse onboarding poll into one cached query`.
- Do NOT push unless instructed.

## Steps

### Step 1: Drive the panel from a single cached competitors query

Refactor `useOnboardingStreaming` so it no longer calls `api.listCompetitors()` directly.
Instead, read the competitors roster from the shared TanStack query (`competitorsQuery`)
via the `QueryClient`, and derive `{ total, analyzed, competitors }` from it. The hook
should:
- Use one query as the source of truth for competitor readiness (`aiSummary != null`),
  eliminating the separate raw `listCompetitors()` fetch.
- Keep firing `first_signal_received` / `analysis_completed` once each, and completing the
  onboarding session, exactly as today (preserve those side effects and their one-shot guards).

Two acceptable implementations — pick the one that fits the existing code with the least churn:
  - (a) Keep the hook's own `setInterval`, but replace `api.listCompetitors()` with
    `queryClient.fetchQuery(competitorsQuery(productId))` (which dedups/caches), and have
    the interval `invalidateQueries` the signals key instead of eager-refetching 200 rows.
  - (b) Convert the readiness source to a `useQuery(competitorsQuery(productId))` with a
    `refetchInterval` **function** that returns `false` once all competitors are ready (or
    a max-attempts cap is hit), and `select`-derive `{ total, analyzed }`. Fire the
    milestone side effects from an effect watching the derived counts.

Whichever you choose, the net effect must be: **one** competitors fetch per tick (not two),
and the signals list is refreshed via `invalidateQueries` (lazy) rather than an eager
200-row `refetchQueries` every 3s.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Gate polling on tab visibility and stop cleanly

Ensure polling pauses when the tab is hidden (`document.visibilityState === "hidden"`) and
resumes when visible — either via TanStack's built-in `refetchIntervalInBackground: false`
(default is already not to poll in background for `useQuery` intervals — verify), or by
skipping the tick when hidden if you keep a manual `setInterval`. Preserve the existing
cleanup (`live = false; stop()`), the `SAFETY_MS` cap, and the one-shot milestone guards.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Simplify `overview.tsx` wiring

Update `load`/the hook wiring so the overview no longer eager-refetches both queries on
every tick. The onboarding panel fills as competitors become ready (from the shared query
`select`), and signals refresh via invalidation. Keep the error-retry path working (the
manual "retry" that also calls `load` should still function — point it at
`invalidateQueries` for both keys, which is fine for a one-off retry).

**Verify**: `pnpm typecheck` → exit 0. Confirm no `api.listCompetitors()` call remains in
`use-onboarding-streaming.ts` (`grep -n "listCompetitors" apps/web/src/hooks/use-onboarding-streaming.ts` → no matches).

## Test plan

- This is UI polling logic; there is no existing harness to render it under `bun test`,
  and the WSL2 host can't run the browser. Verification is `pnpm typecheck` + careful
  behavior-preservation review. If a small pure helper is extracted (e.g. a
  `deriveReadiness(competitors) → { total, analyzed }` function), add a unit test for it
  under `apps/web/test/` following `apps/web/test/format-tier-price.test.ts`.
- Reviewer must confirm the milestone events (`first_signal_received`,
  `analysis_completed`) and session completion still fire exactly once.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `use-onboarding-streaming.ts` no longer calls `api.listCompetitors()` (grep clean)
- [ ] Each poll triggers **one** competitors fetch, not two; signals refresh via
      `invalidateQueries`, not an eager 200-row `refetchQueries`
- [ ] Polling does not run while the tab is hidden
- [ ] Milestone events + session completion still fire once each (verified by review)
- [ ] Only the two in-scope files (+ optional extracted helper/test) changed (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- `competitorsQuery`'s returned row shape does not include `aiSummary` (so readiness can't
  be derived from it) — report; do not add a second fetch back.
- Removing the eager signals refetch would break a visible behavior you can't otherwise
  preserve (e.g. the "watching → populated" flip gates specifically on a fresh 200-row
  fetch) — report the coupling rather than guessing.
- The one-shot milestone guards can't be preserved under a `useQuery` refactor without
  races — fall back to implementation (a) (keep the interval, just dedup the fetch).

## Maintenance notes

- The steady-state 60s `refetchInterval` on the overview's signals-200 query is a separate,
  smaller cost (noted, deferred) — a later pass could `select` a lighter projection or drop
  it since criticals arrive via SSE.
- Reviewer should confirm no duplicate in-flight competitor requests remain during
  onboarding (the whole point of the fix).
