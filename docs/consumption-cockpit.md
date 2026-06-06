# Consumption Cockpit — Phase A

Spec for the first phase of the "consumption & activation" track. Outrival is
strong on collection/detection (sources, scraping cascade, staged extraction,
platform detection, notification moderation) but weak on letting a user *consume*
the intelligence and *act* on it. The rich time-series we already write
(`pricing_history`, `job_counts`, `review_scores`, `tech_stack_history`) is
barely visualised, the sector-trend engine has no page of its own, and plan
limits are enforced but invisible.

Phase A closes that gap with **read-only views on data that already exists**.

> Scope split (decided 2026-06-06): the consumption track ships in three phases.
> **A — Consumption Cockpit** (this doc): zero DB migration, pure read/viz.
> **B — Activation & retention** (intel→action loop, watchlists, onboarding
> checklist, what's-new): small staged migrations. **C — Distribution & team**
> (CRM, collaboration): heavy, external, last. Phases B and C get their own docs.

## Hard constraints (Phase A)

- **No DB migration.** Every feature reads existing tables. No `db:push`.
- **No new pipeline / job / scraper / AI call.** UI + read endpoints only.
- **No new dependency.** Charts reuse `recharts` (already `^3.8.1`, used in
  `/admin`) and the hand-rolled `sparkline.tsx`.
- **Analytics tables are competitor-keyed and org-agnostic** (no `org_id`, no
  FK — best-effort logging). Every trends/compare read therefore:
  1. resolves the org's competitor IDs relationally
     (`competitors` where `org_id = $org` and `deleted_at is null`),
  2. filters the analytics table by `competitor_id in (...)`.
  This is also what enforces tenant isolation — an org only ever passes its own
  competitor IDs into `analyticsQuery`.
- All analytics reads go through `analyticsQuery<T>(sql)` (best-effort, returns
  `[]` on error). A trends widget degrades to an empty state, never a 500.
- Lookback is capped by a `window` param (default 90d). This anticipates the
  deferred `historyRetentionDays` purge — we never assume data older than the
  tier retention exists.

## Features

### 1. Trends dashboard — `/dashboard/trends`

New top-level page, new rail entry. Cross-competitor visualisation of the
time-series. Four sections (stacked, each independently degradable):

| Section | Source table | Landing widget | Drill-down |
|---|---|---|---|
| Pricing moves | `pricing_history` | leaderboard: who changed price in the window (Δ vs previous batch) | line chart of one plan's price over time, per competitor |
| Hiring velocity | `job_counts` | net openings added (window) + department mix per competitor | stacked area of count by department over time |
| Review trajectory | `review_scores` | latest score + Δ per competitor/source | line of score over time, **self vs competitors** overlaid; sub-score radar (ease/support/features/value) |
| Tech changes | `tech_stack_history` | recent appeared/disappeared across all competitors | per-competitor timeline |

Strategic framing to surface in copy (this is the *why*): department mix on
hiring is the read — sales-heavy = scaling GTM, eng-heavy = building product.

**"Current set" semantics**: the latest batch per competitor =
`distinct on (competitor_id, plan_name) … order by recorded_at desc` for pricing
(same shape for the others). Deltas use a window function (`lag`) over
`recorded_at`.

**API** — new `apps/api/src/routes/trends.ts` (auth). The four per-metric
drill-downs were consolidated into one generic `series` endpoint (the client
pivots `{t,key,value}` into multi-line):

```
GET /api/trends/summary?window=90
  → { window, pricing: PricingMove[], hiring: HiringMove[],
      reviews: ReviewMove[], tech: TechMove[] }   cross-competitor leaderboards.
GET /api/trends/series?competitorId=&metric=pricing|hiring|reviews&window=90
  → { metric, competitorId, points: [{ t, key, value }] }
    key = plan / department / review source; ownership-checked.
```

Each resolves the caller's competitor IDs first, then a single `analyticsQuery`.
The series endpoint validates competitor ownership before reading. `window` is
capped (≤365) and defaults to 90.

**Web**: thin `page.tsx` → `<TrendsView/>` client component fetching via the
`api` client. Charts = `recharts` for the drill-downs, `sparkline.tsx` for inline
leaderboard trends.

### 2. Comparison matrix — `/dashboard/compare`

The flagship competitive-intel view: N competitors in columns, comparable
attributes in rows. Battle cards are 1:1 documents; this is the N-wide grid.

- Column picker: pick competitors (default all active, capped at a sane N for
  layout). Optional **"You"** column = the self-competitor.
- Rows (all from data already on the competitor detail / latest analytics batch):

  | Row | Source |
  |---|---|
  | Positioning (category, audience, value prop) | competitor profile / `ai_summary` |
  | Pricing (entry tier, top tier, billing options) | latest `pricing_history` batch |
  | Hiring (open roles, top department) | latest `job_counts` batch |
  | Reviews (avg score + count per source) | latest `review_scores` batch |
  | Notable tech | `tech_stack_entries` (present state) |
  | Last activity / latest signal severity | `signals` / `changes` |

- **API** — `GET /api/compare?competitorIds=a,b,c` (auth) assembles a normalised
  matrix server-side so the client stays dumb. One endpoint, all reads scoped by
  resolving the IDs against the org first (reject IDs not owned by the org).
- **Export**: copy-to-clipboard / CSV of the matrix, in-page (small). PDF reuses
  the battle-card Playwright path later — out of scope for Phase A.
- Saved column selections come in Phase B (watchlists); Phase A is ad-hoc pick.

### 3. Sector trends — dedicated page `/dashboard/sector`

Today `SectoralSignalsSection` is embedded in the overview, hides when empty,
hard limit 50. Promote it to a real page.

- Reuses the existing `sectoralRouter` (`GET /`, `POST /:id/read`,
  `POST /:id/dismiss`) and the existing component, lifted to a page-level view.
- Adds: filter by `category`, an "show dismissed" toggle, pagination beyond 50,
  read/unread state already present.
- **API**: additive query params only on the existing route
  (`?includeDismissed=`, `?category=`, `?offset=`) — no migration.
- Keep a teaser on the overview (top 3) that links to the full page.

### 4. Usage page — `/dashboard/settings/usage`

Plan limits are enforced (`apps/api/src/lib/plan.ts`) but invisible. Make them
glanceable so the upgrade prompt lands at the right moment. Lives in the
**Workspace** settings group next to Billing, cross-linked from the billing page.

Metrics — all already computable, **no new tables**:

| Item | Computation (existing) | Period |
|---|---|---|
| Competitors | `countActiveCompetitors(org)` / `maxCompetitors` | current |
| Products (SKUs) | active products count / `productLimit(plan)` | current |
| Battle cards | `dimensionUsage(org,"battleCardsPerDay")` / `battleCardsPerDay` | day |
| Discoveries | `discoveryRuns.detectCount` / `discoveriesPerMonth` | month |
| Forced rescans | count from `forced_rescan_log` / `forcedRescansPerDay` | day (per-user cap, show org aggregate + note) |
| Sources / frequency / channels | static from `PLAN_LIMITS` entitlements | informational |
| History retention | `historyRetentionDays` | informational (purge deferred) |

- **API** — `GET /api/usage` (auth) → `{ plan, items: [{ dimension, used, limit, period, suggestedPlan }] }`.
  Reuses `plan.ts` helpers; add a small read-only aggregator
  (`getUsageSnapshot(orgId)` in `plan.ts`, or inline in a new `usage.ts` route).
  No migration.
- Each capped row links to upgrade — reuse `PaywallDialog` / `suggestedPlan`
  plumbing (`paywallFromError`).

## Shared work

- **Nav** (`AppSidebar`): add **Trends** and **Compare** to the main rail; **Sector**
  either in the rail or as a tab off Signals; **Usage** under Settings › Workspace.
- **API client** (`apps/web/src/lib/api.ts`): typed methods for the new endpoints.
- Reuse `recharts` + `sparkline.tsx`; no new deps.

## Out of scope (deferred)

- Saved column selections / watchlists for Compare → **Phase B**.
- CSV/PDF export beyond clipboard; quarterly landscape report → later (battle-card
  PDF infra reusable).
- Intel→action tracking on a trend/signal → **Phase B**.
- `historyRetentionDays` purge enforcement → separate (tier-limits backlog).

## Implementation order (each = its own commit)

1. **Usage page** — smallest, self-contained, reuses `plan.ts`. Warm-up.
2. **Sector page** — reuses component + router, additive query params only.
3. **Trends dashboard** — biggest; ship sections incrementally
   (pricing → hiring → reviews → tech).
4. **Comparison matrix** — assembles trends accessors + profile data; build after
   trends so the data layer already exists.

Phase A may split into two Notion items if it grows ("Analytics cockpit" =
trends + compare; "Cockpit pages" = sector + usage + nav). One doc either way.
