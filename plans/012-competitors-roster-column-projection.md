# Plan 012: Stop shipping unused jsonb columns from the polled competitors-roster endpoint

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result. If anything in "STOP conditions" occurs,
> stop and report. When done, update this plan's row in `plans/README.md` unless a
> reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 81c4b75..HEAD -- apps/api/src/routes/competitors.ts apps/web/src/lib/api.ts packages/db/src/schema/competitors.ts`
> If any changed, compare against "Current state" before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (complements 011)
- **Category**: perf
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

The competitors-roster endpoint (`GET /api/competitors`) selects **every** column via an
unprojected `db.query.competitors.findMany({...})` and then spreads `...c` into each
response row. The `competitors` table carries heavy jsonb the client never reads:
`selfProfile`, `overrides` (full pricing-tier override arrays), and `platformProfile`
(platform-detection payload, populated for most established competitors). This endpoint is
fetched by Overview, the Competitors page, Compare, the sidebar roster, and — during
onboarding — repeatedly (see plan 011). Every roster fetch serializes and ships jsonb that
is discarded on arrival. Projecting the query to the fields the response actually uses
shrinks a frequently-polled payload with no behavior change.

## Current state

- **The query** — `apps/api/src/routes/competitors.ts:628`:
  ```ts
  const list = await db.query.competitors.findMany({
    where: and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt), ne(competitors.type, "self"),
               restrictIds ? inArray(competitors.id, restrictIds) : undefined),
    orderBy: desc(competitors.createdAt),
  });   // no `columns:` projection → selects ALL columns
  ```
- **The spread** — `competitors.ts:771-803`:
  ```ts
  const enriched = list.map((c) => ({
    ...c,                              // <-- spreads every selected column, incl. the heavy jsonb
    specificProductIds: ...,
    pausedByPlan: ...,
    freshness: ...,
    analysis: deriveAnalysisStatus({ hasSummary: Boolean(c.aiSummary), anchor: ... }, nowMs),
    stats: { ... },
  }));
  return c.json({ competitors: enriched });
  ```
- **The client type** — `apps/web/src/lib/api.ts` declares a `Competitor` type for this
  list that does **not** include `overrides`, `platformProfile`, or `selfProfile` (they are
  shipped and discarded). It DOES use fields like `id`, `name`, `url`, `color`, `category`,
  `overlapScore`, `aiSummary`, `createdAt`, `type`, plus the added `specificProductIds`,
  `pausedByPlan`, `freshness`, `analysis`, `stats`.
- **The schema** — `packages/db/src/schema/competitors.ts` defines the columns; the
  jsonb ones to exclude are `selfProfile`, `overrides`, `platformProfile` (and any other
  detail-only column not consumed by the list — verify against the client `Competitor` type).
- The **detail** endpoint `GET /api/competitors/:id` (`competitors.ts:808+`) is separate
  and legitimately needs the full row — do not touch it.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0 |
| API tests | `pnpm --filter @outrival/api test` | all pass |
| Full suite | `pnpm test` | exit 0 |

## Scope

**In scope**:
- `apps/api/src/routes/competitors.ts` — add a `columns` projection to the list `findMany`.

**Out of scope**:
- `GET /api/competitors/:id` (detail) — needs the full row.
- The web `Competitor` type — it already omits the excluded fields; only touch it if
  typecheck reveals the list actually reads one of the fields you're about to drop (then
  keep that field, don't widen the type).
- Any other route's `findMany`.

## Git workflow

- Branch: `advisor/012-competitors-roster-projection`
- One commit, conventional: `perf(api): project the competitors roster query to used columns`.
- Do NOT push unless instructed.

## Steps

### Step 1: Enumerate the columns the list response actually uses

Read the enrichment block (`competitors.ts:771-803`) and the web `Competitor` list type in
`apps/web/src/lib/api.ts`. Build the allowlist of `competitors` columns consumed: at least
`id`, `orgId`, `name`, `url`, `color`, `description`, `category`, `overlapScore`,
`aiSummary`, `aiSummaryUpdatedAt`, `type`, `createdAt`, `updatedAt`, `deletedAt` (verify
each against actual usage — include a column only if the list response or enrichment reads
it). Confirm `overrides`, `platformProfile`, `selfProfile` are **not** read anywhere in the
list path.

**Verify**: `grep -n "c\.\(overrides\|platformProfile\|selfProfile\)" apps/api/src/routes/competitors.ts`
returns no matches inside the list handler (only, if at all, in the `:id` detail handler).

### Step 2: Add the `columns` projection

Add a `columns: { ... }` allowlist to the list `findMany` at line 628, set to the fields
from Step 1 (`true` each). This restricts what `...c` spreads to exactly the used set:
```ts
const list = await db.query.competitors.findMany({
  columns: {
    id: true, orgId: true, name: true, url: true, color: true, description: true,
    category: true, overlapScore: true, aiSummary: true, aiSummaryUpdatedAt: true,
    type: true, createdAt: true, updatedAt: true, deletedAt: true,
    // (add/remove to match Step 1 exactly; exclude selfProfile/overrides/platformProfile/metadata jsonb)
  },
  where: and(...),
  orderBy: desc(competitors.createdAt),
});
```

**Verify**: `pnpm typecheck` → exit 0 (if a dropped column was actually used, typecheck
fails here — add it back; that's the safety net).

### Step 3: Confirm behavior unchanged

**Verify**: `pnpm --filter @outrival/api test` → all pass. If there's a competitors-list
test asserting the response shape, it should still pass (the excluded fields were never in
the client type). If a test asserts on an excluded jsonb field, that's a STOP — confirm
whether the client truly needs it.

## Test plan

- Rely on the existing `apps/api` competitors route tests (PGlite harness) as the
  regression guard for the response shape. If none asserts the roster shape, add a minimal
  case to `apps/api/src/routes/competitors.test.ts` (or the nearest existing file) asserting
  the list response includes the used fields and the enrichment fields (`stats`,
  `freshness`, `analysis`, `pausedByPlan`, `specificProductIds`) — following an existing
  route test's structure.
- Verification: `pnpm --filter @outrival/api test` → all pass; `pnpm typecheck` exits 0.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] The list `findMany` has an explicit `columns` allowlist excluding
      `selfProfile`/`overrides`/`platformProfile` (and other detail-only jsonb)
- [ ] `pnpm --filter @outrival/api test` passes
- [ ] `GET /api/competitors/:id` is unchanged (`git diff` shows no edit to the detail handler)
- [ ] Only `competitors.ts` (and possibly one added test) changed (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- Typecheck reveals the list path reads one of the fields you intended to drop — keep that
  field (do not widen the client type to accommodate a removal you can revert).
- A test asserts on an excluded jsonb field, implying a client somewhere does read it from
  the list — report before proceeding.
- The `findMany` uses relational `with:` includes you didn't account for — report.

## Maintenance notes

- If a future list feature needs `platformProfile`/`overrides`, add just that column to the
  projection rather than reverting to a full select.
- Pairs with plan 011: shrinking this payload most benefits the onboarding poll and the
  60s steady-state roster refetch.
- Reviewer should confirm the enrichment (`stats`/`freshness`/`analysis`) still has every
  input column it reads (e.g. `aiSummary` for `deriveAnalysisStatus`).
