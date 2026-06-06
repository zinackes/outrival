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
| `usersPerOrg` | 1 | 1 | 3 | 10 |
| `historyRetentionDays` | 7 | 30 | 365 | 1095 |
| `features.battleCards` | ✓ | ✓ | ✓ | ✓ |
| `features.api` | ✗ | ✗ | ✗ | ✓ |
| `features.crmIntegrations` | ✗ | ✗ | ✗ | ✓ |
| `features.fullMode` | ✗ | ✓ | ✓ | ✓ |

No "unlimited" anywhere — every cap is a real number (transparency choice).

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

Notes:
- **Battle cards opened to every tier** (was a pro+ feature gate). The daily cap is the
  cost guard. The count is "distinct cards generated/refreshed today" (cards upsert per
  product×competitor); repeated regen of the same card is free, and the async-completion
  race is backstopped by `aiIntensiveRateLimit` (10/h/user).
- **Discoveries** consume the monthly quota only on **on-demand `/detect`** — the weekly
  cron auto-discovery does not (free's 3/month would be eaten by the cron otherwise). The
  single `discovery_runs` row doubles as the calendar-month counter (resets on month roll).
- `forcedRescansPerDay` / `forced_rescan_log` keep their bespoke nested error
  (`{ error: { code, message, upgradeHint } }`) — the web `use-force-rescan` toast reads
  it. Not rerouted through `tierLimitBody` to avoid churning a working path.
- `FORCED_RESCAN_LIMIT_*` env still overrides the `PLAN_LIMITS` defaults (back-compat).

## Deferred (TODO — value in the source of truth, enforcement later)

- **`historyRetentionDays`** — no purge job yet. Needs a per-org cron purging PG
  (signals/changes) + ClickHouse beyond the tier window.
- **`usersPerOrg`** — multi-user (invitations/RBAC) is Phase 10; the cap is carried but
  there's no invitation flow to gate. `features.multiUser` stays business-only until then.
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
