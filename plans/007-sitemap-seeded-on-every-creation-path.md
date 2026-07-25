# Plan 007: Every competitor gets a `sitemap` monitor, whichever path created it

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- apps/api/src/routes/competitors.ts apps/api/src/routes/candidates.ts apps/api/src/routes/onboarding.ts`
> If any of those changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

A competitor can be created three ways: manually (`POST /api/competitors`), by
promoting a discovery candidate (`POST /api/candidates/:id/add`), and during
onboarding (`POST /api/onboarding/complete`). All three seed a set of internal
monitor anchors. Only the manual path seeds `sitemap`.

`sitemap` is not cosmetic. It is declared an automatic source, and the web UI
renders it read-only as "Monitored automatically, can't be turned off". More
importantly, the sitemap branch of `scrape-monitor` is what detects a **new
comparison page**: when a competitor publishes `/vs/...`, `/alternatives/...`, or
a `{name}-alternative` slug, the sitemap URL-set diff emits a forced
`content/high` signal, escalated to **`content/critical` with a realtime alert**
when the slug names the user's own organisation.

"A competitor just built a page targeting you by name" is close to the most
valuable single alert this product can send. For any competitor created through
onboarding or discovery, it can never fire.

Onboarding and discovery are the primary acquisition paths, so this likely
affects most competitors in the product. The comment in the onboarding seed block
even claims it "mirrors the manual-creation path", which is what makes the gap
easy to miss on review.

## Current state

### Path 1: manual creation seeds 9 monitors, including `sitemap` (`apps/api/src/routes/competitors.ts:583-612`)

```ts
  const scrapeStartedAt = new Date();
  const createdMonitors = await db
    .insert(monitors)
    .values([
      { competitorId: competitor.id, sourceType: "homepage", frequency: "daily", scrapeStartedAt },
      { competitorId: competitor.id, sourceType: "pricing", frequency: "daily", scrapeStartedAt },
      { competitorId: competitor.id, sourceType: "blog", frequency: "weekly", scrapeStartedAt },
      // patch-32: internal sitemap-diff anchor (weekly). Not user-facing; the diff
      // of its sorted URL-list snapshot surfaces brand-new competitor pages.
      { competitorId: competitor.id, sourceType: "sitemap", frequency: "weekly", scrapeStartedAt },
      { competitorId: competitor.id, sourceType: "news", frequency: "weekly", scrapeStartedAt },
      { competitorId: competitor.id, sourceType: "subdomains", frequency: "weekly", scrapeStartedAt },
      { competitorId: competitor.id, sourceType: "youtube", frequency: "weekly", scrapeStartedAt },
      { competitorId: competitor.id, sourceType: "hackernews", frequency: "weekly", scrapeStartedAt },
      { competitorId: competitor.id, sourceType: "wellknown", frequency: "weekly", scrapeStartedAt },
    ])
    .returning();
```

(Comments trimmed above for length; the live file has a comment block per anchor.
Preserve them.)

### Path 2: discovery-add seeds 8, with **no `sitemap`** (`apps/api/src/routes/candidates.ts:572-595`)

```ts
  const scrapeStartedAt = new Date();
  const monitorRows = await db
    .insert(monitors)
    .values([
      { competitorId: competitor.id, sourceType: "homepage", frequency: "daily", scrapeStartedAt },
      { competitorId: competitor.id, sourceType: "pricing", frequency: "daily", scrapeStartedAt },
      { competitorId: competitor.id, sourceType: "blog", frequency: "weekly", scrapeStartedAt },
      // Internal news/funding anchor (weekly) — see competitors.ts POST. ...
      { competitorId: competitor.id, sourceType: "news", frequency: "weekly", scrapeStartedAt },
      { competitorId: competitor.id, sourceType: "subdomains", frequency: "weekly", scrapeStartedAt },
      { competitorId: competitor.id, sourceType: "youtube", frequency: "weekly", scrapeStartedAt },
      { competitorId: competitor.id, sourceType: "hackernews", frequency: "weekly", scrapeStartedAt },
      { competitorId: competitor.id, sourceType: "wellknown", frequency: "weekly", scrapeStartedAt },
    ])
    .returning();
```

Note that each anchor's comment says "see competitors.ts POST", so this list was
copied from the manual path and `sitemap` was simply dropped.

### Path 3: onboarding seeds user-chosen sources plus anchors, with **no `sitemap`** (`apps/api/src/routes/onboarding.ts:676-711+`)

```ts
      .insert(monitors)
      .values([
        ...monitoringPrefs.sources.map((sourceType) => ({
          competitorId: competitor.id,
          sourceType,
          frequency: monitoringPrefs.frequency,
          scrapeStartedAt,
        })),
        // Internal news anchor (never user-selectable, not plan-gated) — mirrors
        // the manual-creation path so the day-0 landscape has dated events
        // (funding, launches, press) to show from the very first scrape.
        { competitorId: competitor.id, sourceType: "news" as const, frequency: "weekly" as const, scrapeStartedAt },
        { competitorId: competitor.id, sourceType: "subdomains" as const, frequency: "weekly" as const, scrapeStartedAt },
        { competitorId: competitor.id, sourceType: "youtube" as const, frequency: "weekly" as const, scrapeStartedAt },
        // ... hackernews, wellknown follow
      ])
```

The "mirrors the manual-creation path" claim at line 684-686 is false.

### Confirming the gap mechanically

```bash
grep -c sitemap apps/api/src/routes/competitors.ts   # non-zero
grep -c sitemap apps/api/src/routes/candidates.ts    # 0
grep -c sitemap apps/api/src/routes/onboarding.ts    # 0
```

### Why `sitemap` is not user-selectable

`sitemap` is an internal/automatic source. It is never offered in the enable-a-source
flow and is not plan-gated: the manual path seeds it unconditionally, alongside
`news`, `subdomains`, `youtube`, `hackernews` and `wellknown`. So adding it to the
other two paths needs **no** plan check and no gating logic.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| API tests | `cd apps/api && bun test --timeout 60000 test/` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Whole suite | `pnpm test` | exit 0 |

Note: `turbo` is **not** on `PATH`. Use the `pnpm` scripts.

## Scope

**In scope** (the only files you should modify or create):
- `apps/api/src/lib/monitor-seed.ts` (create: the shared anchor list)
- `apps/api/src/routes/competitors.ts` (use it)
- `apps/api/src/routes/candidates.ts` (use it)
- `apps/api/src/routes/onboarding.ts` (use it)
- `apps/api/test/monitor-seed.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- The **frequencies** of any existing anchor, and the `homepage`/`pricing`/`blog`
  trio. Only the missing `sitemap` anchor is being added.
- Onboarding's `monitoringPrefs.sources` spread and its plan gating
  (`isSourceAllowed` / `plan_locked_source`). User-chosen sources are gated;
  internal anchors are not. Keep that distinction exactly as it is.
- A backfill for competitors that already exist without a `sitemap` monitor.
  That is a data change and is deliberately deferred; see Maintenance.
- The five hand-maintained "internal sources" lists elsewhere in the codebase
  (in `landscape-data.ts`, `activity.ts`, `digests.ts`, `products.ts`,
  `digest-counts.ts`). They have their own drift problem and their own plan.
- `packages/shared/src/sources/catalog.ts`. It already classifies `sitemap`
  correctly as automatic.

## Git workflow

- Branch: `fix/seed-sitemap-on-all-paths` off `main`.
- Commit message style, matching `git log`: `fix(api): seed sitemap on every path`.
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Confirm the gap

Run the three `grep -c sitemap` commands above.

**Verify**: non-zero for `competitors.ts`, `0` for the other two. If
`candidates.ts` or `onboarding.ts` already mentions `sitemap`, STOP.

### Step 2: Extract the anchor list into one place

Create `apps/api/src/lib/monitor-seed.ts` exporting the internal anchors as data,
not as a function that writes to the database (the three call sites build their
`values([...])` arrays differently, and onboarding also spreads user-chosen
sources into the same insert).

```ts
import type { SourceType } from "@outrival/shared";

/**
 * Internal monitor anchors seeded for EVERY new competitor, on all three
 * creation paths (manual POST /competitors, discovery-add, onboarding/complete).
 *
 * These are never user-selectable and never plan-gated — they are infrastructure
 * that makes the automatic sources work. Keeping the list here rather than
 * inline in each route is what stopped `sitemap` from being seeded on two of the
 * three paths, which silently disabled comparison-page detection for every
 * competitor added through onboarding or discovery.
 */
export const INTERNAL_MONITOR_ANCHORS: { sourceType: SourceType; frequency: "weekly" }[] = [
  // ... one entry per anchor, carrying over the explanatory comment from
  // competitors.ts for each one
];
```

Move the existing per-anchor comments from `competitors.ts` into this file: they
are the only documentation of what each anchor does, and they should not be lost
or duplicated.

The list must contain, all at `weekly`: `sitemap`, `news`, `subdomains`,
`youtube`, `hackernews`, `wellknown`.

**Verify**: `pnpm typecheck` exits 0.

### Step 3: Use it in all three routes

In each route, replace the inline anchor entries with a spread that maps the
shared list onto that route's row shape:

```ts
...INTERNAL_MONITOR_ANCHORS.map((a) => ({
  competitorId: competitor.id,
  sourceType: a.sourceType,
  frequency: a.frequency,
  scrapeStartedAt,
})),
```

Keep `homepage` / `pricing` / `blog` inline where they already are: they carry
different frequencies (`daily`, `daily`, `weekly`) and, in onboarding, are
replaced by the user's chosen sources.

In `onboarding.ts`, place the spread where the current anchor entries are, after
the `monitoringPrefs.sources` spread, and **fix the now-true comment** so it
still reads accurately.

**Verify**: `pnpm typecheck` exits 0, and
`grep -c INTERNAL_MONITOR_ANCHORS apps/api/src/routes/*.ts` returns 3.

### Step 4: Pin it with a test

Create `apps/api/test/monitor-seed.test.ts` (the package runs `bun test test/`).

Two tests, both pure, no database needed:

1. `INTERNAL_MONITOR_ANCHORS` contains `sitemap`, and contains exactly the six
   expected source types with no duplicates.
2. The regression guard: assert that all three route files reference the shared
   constant. This is a structural test (read the three files, assert each
   contains `INTERNAL_MONITOR_ANCHORS`) and it is what stops path four from being
   added with a hand-copied list.

If the api test harness makes a database-backed test cheap, an integration test
asserting all three paths produce the same anchor set is stronger. Only do that
if the existing harness supports it without new infrastructure; the pure tests
are the requirement.

**Verify**: `cd apps/api && bun test --timeout 60000 test/` passes.

### Step 5: Full-suite check

**Verify**: `pnpm typecheck` exits 0 and `pnpm test` exits 0.

## Test plan

- New file `apps/api/test/monitor-seed.test.ts`:
  - `INTERNAL_MONITOR_ANCHORS` includes `sitemap` (the specific regression)
  - the list has exactly six entries, no duplicates, all `weekly`
  - all three creation routes reference the shared constant
- Structural pattern to model: an existing pure test under `apps/api/test/`.
  If you use the database harness, model it on `apps/api/test/competitors.test.ts`
  and follow its "install mocks, then dynamically import" ordering — a static
  top-level import of a router without the harness makes the test order-dependent.
- Verification: `cd apps/api && bun test --timeout 60000 test/` all pass;
  `pnpm test` exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c sitemap apps/api/src/lib/monitor-seed.ts` returns at least 1
- [ ] `grep -c INTERNAL_MONITOR_ANCHORS apps/api/src/routes/competitors.ts apps/api/src/routes/candidates.ts apps/api/src/routes/onboarding.ts`
      shows a non-zero count for each of the three files
- [ ] No route file still lists `news`, `subdomains`, `youtube`, `hackernews` or
      `wellknown` inline in its monitor insert
- [ ] The onboarding comment claiming it mirrors the manual path is now accurate
- [ ] `cd apps/api && bun test --timeout 60000 test/` exits 0, with the new tests
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `candidates.ts` or `onboarding.ts` already seeds `sitemap`. The gap closed
  between this plan being written and executed.
- Onboarding's insert turns out to run inside a loop over multiple competitors
  with different shapes such that a single shared spread does not fit. Report the
  shape rather than duplicating the list again.
- Adding `sitemap` to the onboarding path trips a plan gate
  (`plan_locked_source`). It should not: internal anchors are seeded outside
  `isSourceAllowed`. If it does, you are inserting it in the wrong place, inside
  the user-chosen-source spread. Fix the placement; do not weaken the gate.
- You are tempted to write a backfill that adds `sitemap` monitors to existing
  competitors. Do not, in this plan. See Maintenance.

## Maintenance notes

- **Existing competitors are not fixed by this plan.** Every competitor already
  created through onboarding or discovery still has no `sitemap` monitor, so
  comparison-page detection stays dark for them. A backfill is a single
  `INSERT ... SELECT` over competitors lacking a `sitemap` row, but it will cause
  a burst of first-time sitemap scrapes across the whole install base, and the
  first diff of a brand-new sitemap anchor has no previous snapshot to compare
  against. Size that burst and pick a rollout before running it. Worth doing;
  worth doing deliberately.
- **Adding a fourth creation path** (an import flow, a bulk add) must use
  `INTERNAL_MONITOR_ANCHORS`. The structural test in step 4 is what enforces it.
- **Adding a new internal anchor** is now a one-line change in one file instead of
  three. That is the point of the extraction.
- A reviewer should check that user-chosen sources are still plan-gated and only
  the internal anchors bypass gating. Conflating the two would let a free-tier
  org seed paid sources.
