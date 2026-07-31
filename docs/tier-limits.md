# Tier limits — single source of truth

Decided 2026-06-04 (Notion "Repenser limites par tier"). Centralises every per-tier
limit in `PLAN_LIMITS` (`@outrival/shared`) and enforces the period-based caps at the
point of consumption with a structured (never-500) error the web turns into an
upgrade prompt.

> A **tier** is a **plan** here — `Plan` (`free | starter | pro | business`) *is* the
> tier axis. `PLAN_LIMITS` is the one table; `Tier` is an alias of `Plan`. We did not
> spin up a parallel `TIER_LIMITS` module — a second table is exactly the divergence
> this work removes.

## The grid

| Dimension | free | starter | pro | business |
|---|---|---|---|---|
| `maxCompetitors` | 2 | 5 | 15 | **50** |
| `scrapeFrequency` | weekly | daily | daily_adaptive | daily_priority |
| `forcedRescansPerDay` | 1 | 5 | 20 | **100** |
| `battleCardsPerDay` | 1 | 10 | 50 | 100 |
| `discoveriesPerMonth` | 3 | 20 | 100 | 500 |
| `aiActionsPerHour` | 20 | 40 | 120 | 300 |
| `usersPerOrg` | 1 | 1 | 3 | 10 |
| `historyRetentionDays` | 7 | 30 | 365 | 1095 |
| `features.battleCards` | ✓ | ✓ | ✓ | ✓ |
| `features.api` | — | — | — | planned |
| `features.crmIntegrations` | ✗ | ✗ | ✗ | ✓ |
| `features.fullMode` | ✗ | ✓ | ✓ | ✓ |
| `features.multiUser` | — | — | — | planned |

No "unlimited" anywhere — every cap is a real number (transparency choice).

> **`features.api` / `features.multiUser` are advertised but not yet delivered** — no
> `api_keys` table / public route, and `FEATURE_FLAGS.multiUser = false` (Members page
> 404s). Both flags are `false` on every tier until built, so the grid marks them
> **planned** rather than shipped. See `docs/paid-feature-delivery.md` for the
> sold-vs-exists evidence and the deliver-vs-hide decision.

## Enforced now

`assertWithinLimit(orgId, dimension)` (`apps/api/src/lib/plan.ts`) is read-only and
returns `{ ok, used, limit, plan, dimension }`. Callers reject with
`tierLimitBody(check)` (a flat `{ error: <code>, dimension, used, limit, plan,
suggestedPlan, upgradeHint }`) then perform the action.

| Dimension | Where | Error code / status | Counter |
|---|---|---|---|
| `maxCompetitors` | `checkCompetitorQuota` → competitors.ts, candidates.ts | `plan_limit_competitors` 403 | live count (existing) |
| products (SKU) | `productLimit` → products.ts | `plan_limit_products` 403 | live count (existing) |
| `forcedRescansPerDay` | `forcedRescansPerDay(plan)` → monitors.ts | `rescan_limit_reached` 429 | `forced_rescan_log` /user/day (existing) |
| `battleCardsPerDay` | `assertWithinLimit` → battle-cards.ts | `battlecard_limit_reached` 429 | `battle_cards.generatedAt` today (DB-free) |
| `discoveriesPerMonth` | `assertWithinLimit` → candidates.ts `/detect` | `discovery_limit_reached` 429 | `discovery_runs.detect_count` + `detect_count_month` |
| `aiActionsPerHour` | `aiIntensiveRateLimit` middleware + `consumeAiAction` → monitors.ts | `ai_rate_limit_exceeded` 429 | Redis `ratelimit:ai_intensive:<userId>` /user/hour |

Notes:
- **Battle cards opened to every tier** (was a pro+ feature gate). The daily cap is the
  cost guard. The count is "distinct cards generated/refreshed today" (cards upsert per
  product×competitor); repeated regen of the same card is free, and the async-completion
  race is backstopped by `aiIntensiveRateLimit` (`aiActionsPerHour`, per tier).
- **Discoveries** consume the monthly quota only on **on-demand `/detect`** — the weekly
  cron auto-discovery does not (free's 3/month would be eaten by the cron otherwise). The
  single `discovery_runs` row doubles as the calendar-month counter (resets on month roll).
- `forcedRescansPerDay` / `forced_rescan_log` keep their bespoke nested error
  (`{ error: { code, message, upgradeHint } }`) — the web `use-force-rescan` toast reads
  it. Not rerouted through `tierLimitBody` to avoid churning a working path.
- `FORCED_RESCAN_LIMIT_*` env still overrides the `PLAN_LIMITS` defaults (back-compat).
- **`aiActionsPerHour` was a flat 10/h for every tier** from patch-22 to 2026-07-31, so
  free and business shared one ceiling and the caps it sits above were unreachable in a
  burst (pro buys 20 re-scans + 50 battle cards a day; eleven clicks of any kind refused
  the twelfth). Three properties make the new numbers defensible:
  - It counts **clicks, not pool calls** — a battle card is 1 tick for ~5 calls, a re-scan
    on an unchanged page is 1 tick for 0. It can only ever be a blunt ceiling; the honest
    capacity meter would be weight-per-route, which needs a per-user `ai_runs` counter
    that does not exist yet.
  - **First-time source activation is exempt** (`consumeAiAction` is called inside
    `/monitors/:id/run` and `/:id/force-rescan`, only when `lastRunAt !== null`) — the same
    reason it is already exempt from `forcedRescansPerDay`. Enabling every source on a pro
    roster is `maxCompetitors × allowedSources` = 135 clicks; no anti-abuse ceiling should
    have to accommodate a setup burst.
  - Heavy legitimate use tops out near 40/h once activation is out of the bucket, while a
    runaway client does hundreds. The numbers sit in that gap.
- `AI_INTENSIVE_RATE_LIMIT` survives as a **single-value emergency override**: setting it
  re-flattens every tier onto one number. Leave it unset (`.env.example` ships it commented).

Whether a free workspace ever *encounters* these gates (vs. hitting them silently)
is a separate question from whether they're enforced. 📄 docs/monetization-first-encounter.md

## Deferred (TODO — value in the source of truth, enforcement later)

- **`historyRetentionDays`** — no purge job yet. Needs a per-org cron purging PG
  (signals/changes) + ClickHouse beyond the tier window.
- **`usersPerOrg`** — multi-user (invitations/RBAC) is Phase 10; the cap is carried but
  there's no invitation flow to gate. `features.multiUser` is `false` on every tier
  (hidden, not "business-only") until Phase 10 delivers it — see
  `docs/paid-feature-delivery.md`.
- **`features.api`** — Public API is Phase 11; no `api_keys` table or public route exists,
  so the flag is `false` on every tier (hidden) until delivered — see
  `docs/paid-feature-delivery.md`.
- **`scrapeFrequency` `daily_adaptive` / `daily_priority`** — the gate still rides on
  `allowedFrequencies` (and `computeNextRun`, already adaptive). `daily_priority` has no
  distinct queue-priority behaviour yet; the field is the headline label + the `free →
  weekly` cap.
- **`features.crmIntegrations`** — backlog feature; flag only.
- **Fair-use** — the business anti-abuse ceilings (100/day re-scans + battle cards) want a
  throttling/fair-use guard (TOS). `TODO(tier-limits)` marked in `plans.ts`.

## Schema change (db:push pending)

`discovery_runs` gains `detect_count` (int, default 0) + `detect_count_month` (text).
Joins the already-pending patch-28 `db:push` (run against prod with a backup first).
Until pushed, the discovery monthly cap reads 0/null → effectively unlimited (fails open).

## Tests

`packages/shared/src/constants/plans.test.ts` (`bun test`) — pins the grid per dimension
× tier, business `maxCompetitors`=50 (finite), business `forcedRescansPerDay`=100, the env
override, and `isWithinLimit` below/at/above the threshold.
