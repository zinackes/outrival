# Plan 003: Gate on-demand re-scans by plan so a downgraded org can't refresh locked premium sources

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 81c4b75..HEAD -- apps/api/src/routes/monitors.ts apps/api/src/routes/my-product.ts apps/api/src/lib/plan.ts`
> If any in-scope file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

Premium monitor sources (`jobs`, `g2_reviews`, `capterra_reviews`, `status`, …) are plan-gated.
When an org downgrades, its premium monitor rows are **not deleted** — they are merely *frozen* by
the scheduler (`schedule-scraping.job.ts` skips any source the current plan disallows). But the
three on-demand re-scan endpoints trigger a scrape **without** re-checking the plan, so a downgraded
user can press "Re-scan" / "Run now" and force a fresh scrape of a source their plan no longer
entitles them to — refreshing premium competitor data for free (bounded only by the per-tier
forced-rescan/day cap, which every tier has). This is an entitlement-enforcement gap: the gate that
exists in the scheduler is bypassed by the direct triggers. The fix mirrors the scheduler's check.

## Current state

The correct, already-tested gate helper lives in shared and is what the scheduler uses:

- `packages/shared/src/constants/plans.ts` (~lines 145–163):
  ```ts
  export function isGatedSource(source: SourceType): boolean {
    return PLANS.some((p) => PLAN_LIMITS[p].allowedSources.includes(source));
  }
  /** Whether a monitor on `source` may run under `plan`. Ungated sources always run;
   *  gated sources only while the plan still includes them. */
  export function planAllowsMonitorSource(plan: Plan, source: SourceType): boolean {
    return !isGatedSource(source) || planIncludesSource(plan, source);
  }
  ```
  `planAllowsMonitorSource` returns **true** for internal anchors (`tech_stack`, `sitemap`, `news`,
  `ai_visibility`) and not-yet-tiered sources — they appear in no plan's `allowedSources`, so they
  are never gated. This is verified by `packages/shared/src/constants/plans.test.ts:157+`. **Use this
  helper, NOT the API's `isSourceAllowed`** — `isSourceAllowed` (in `apps/api/src/lib/plan.ts:94`) is
  for user-*selectable* sources at enable/onboarding time and would wrongly reject internal anchors.

- The scheduler already does exactly this — `apps/workers/src/jobs/schedule-scraping.job.ts:113`:
  ```ts
  return inCap.has(comp.id) && planAllowsMonitorSource(plan, m.sourceType);
  ```

The three unguarded on-demand triggers:

- `apps/api/src/routes/monitors.ts` — `POST /:id/run` (~line 217): resolves monitor→competitor→org
  ownership, meters the forced-rescan cap, then `await tasks.trigger("scrape-monitor", { monitorId, force: true, … })`. **No source check.** `plan` is already fetched inside the `if (isRescan)` block via `getOrgPlan(orgId)`.
- `apps/api/src/routes/monitors.ts` — `POST /:id/force-rescan` (~line 284): same shape; `plan` fetched
  via `getOrgPlan(orgId)` at the top of the handler. **No source check.**
- `apps/api/src/routes/my-product.ts` — `POST /rescan` (~line 513): loops over `toScrape` monitors and
  triggers each; `plan` fetched at ~line 543. **No source check** (self-product sources are homepage/
  pricing/jobs/github_repo; `jobs` is gated, so this path is affected too).

Current imports in `apps/api/src/routes/monitors.ts` (top of file) already pull from `@outrival/shared`:
```ts
import { MONITOR_FREQUENCIES, validateMonitorUrl, computeNextRun, forcedRescansPerDay, type MonitorFrequency } from "@outrival/shared";
```
`my-product.ts` similarly imports from `@outrival/shared`. Add `planAllowsMonitorSource` to those imports.

Exemplar of the error shape to return (from `apps/api/src/routes/competitors.ts:554`, the enable path):
```ts
if (!isSourceAllowed(plan, sourceType)) {
  return c.json({ error: "plan_locked_source", source: sourceType, plan }, 403);
}
```
The web parses `plan_locked_source` into a paywall (`paywallFromError`), so reuse that exact error body.

## Commands you will need

| Purpose        | Command                                        | Expected on success  |
|----------------|------------------------------------------------|----------------------|
| Typecheck api  | `pnpm --filter @outrival/api typecheck`        | exit 0, no errors    |
| API tests      | `pnpm --filter @outrival/api test`             | all pass (incl. new) |
| Just monitors  | `cd apps/api && bun test test/monitors.test.ts`| all pass             |

(No `pnpm install` needed. Do NOT run `next build` / full `pnpm build`.)

## Scope

**In scope**:
- `apps/api/src/routes/monitors.ts` (both `/run` and `/force-rescan` handlers, + import)
- `apps/api/src/routes/my-product.ts` (`/rescan` loop, + import)
- `apps/api/test/monitors.test.ts` (add coverage)

**Out of scope** (do NOT touch):
- `apps/api/src/lib/plan.ts` — do not change `isSourceAllowed`; do not add a new helper (use the
  existing shared `planAllowsMonitorSource`).
- The forced-rescan cap logic, ownership checks, or the `scrape-monitor` worker.
- `packages/shared` — `planAllowsMonitorSource` already exists and is tested.

## Git workflow

- Branch: `advisor/003-rescan-source-gating`
- One commit; conventional-commit style (e.g. `fix(api): gate on-demand re-scans by plan`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `POST /:id/run` — gate the source before triggering

In `apps/api/src/routes/monitors.ts`, add `planAllowsMonitorSource` to the `@outrival/shared` import.
In the `/:id/run` handler, after the `competitor` ownership check passes and before the metering /
trigger, gate the source. `getOrgPlan(orgId)` is only called inside `if (isRescan)` today; call it (or
reuse the value) so the gate can run. Place the check right after the ownership `if (!competitor) return … 403;`:

```ts
const plan = await getOrgPlan(orgId);
if (!planAllowsMonitorSource(plan, monitor.sourceType)) {
  return c.json({ error: "plan_locked_source", source: monitor.sourceType, plan }, 403);
}
```

Then reuse this `plan` in the existing `if (isRescan)` metering block instead of re-fetching it
(remove the now-duplicate `const plan = await getOrgPlan(orgId);` inside that block if present).

**Verify**: `pnpm --filter @outrival/api typecheck` → exit 0.

### Step 2: `POST /:id/force-rescan` — gate the source before triggering

In the `/:id/force-rescan` handler, `plan` is already fetched near the top (`const plan = await getOrgPlan(orgId);`).
Immediately after that line (and after the ownership check), add:

```ts
if (!planAllowsMonitorSource(plan, monitor.sourceType)) {
  return c.json({ error: "plan_locked_source", source: monitor.sourceType, plan }, 403);
}
```

**Verify**: `pnpm --filter @outrival/api typecheck` → exit 0.

### Step 3: `POST /rescan` (my-product) — skip locked sources in the loop

In `apps/api/src/routes/my-product.ts`, add `planAllowsMonitorSource` to the `@outrival/shared` import.
`plan` is already fetched (~line 543). Inside the `for (const m of toScrape)` loop, skip any monitor
whose source the plan disallows — `continue` past it rather than failing the whole batch (matching the
loop's existing "partial refresh beats a hard wall" behavior):

```ts
for (const m of toScrape) {
  if (!planAllowsMonitorSource(plan, m.sourceType)) continue; // frozen premium source — don't refresh
  const isRescan = m.lastRunAt !== null;
  // ... existing body unchanged
}
```

(Self-product homepage/pricing are ungated → always pass; only a gated source like `jobs` on a
downgraded plan is skipped.)

**Verify**: `pnpm --filter @outrival/api typecheck` → exit 0.

### Step 4: Add tests to `monitors.test.ts`

`apps/api/test/monitors.test.ts` already has a real DB harness: `makeTestDb`, `seedOrg({ plan })`,
`installAppMocks`, a mocked `tasks.trigger` (returns `{ id: "run_test" }`, no network), and `rescan()`
/ `run()` request helpers. Model new tests on the existing ones. Add a `describe` block that:

1. Seeds a `free` org, a competitor in it, and a **gated** monitor that has already run
   (`sourceType: "g2_reviews"` or `"jobs"`, `lastRunAt: new Date(Date.now() - 60_000)`).
2. Asserts `force-rescan` on it → HTTP **403** with body `error: "plan_locked_source"`.
3. Asserts `run` on it → HTTP **403** `plan_locked_source`.
4. Asserts the same org can still `force-rescan` an **ungated** already-run monitor (`sourceType: "homepage"`) → **200** (proves internal/allowed sources are unaffected).

Follow the fixture style at the top of the file (insert into `competitors` / `monitors`). Use a fresh
org so the free forced-rescan cap isn't already spent by other tests.

**Verify**: `cd apps/api && bun test test/monitors.test.ts` → all pass, including the new block. Then
`pnpm --filter @outrival/api test` → all pass.

## Test plan

- New tests in `apps/api/test/monitors.test.ts`:
  - free org, gated already-run source (`g2_reviews`/`jobs`) → `force-rescan` 403 `plan_locked_source`.
  - same → `run` 403 `plan_locked_source`.
  - free org, ungated already-run source (`homepage`) → `force-rescan` 200 (regression guard: internal/
    allowed sources still scrape).
- Structural pattern: the existing ownership/cap tests in the same file.
- Verification: `pnpm --filter @outrival/api test` → all pass, new tests green.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm --filter @outrival/api typecheck` exits 0.
- [ ] `pnpm --filter @outrival/api test` exits 0; new gating tests exist and pass.
- [ ] `grep -n "planAllowsMonitorSource" apps/api/src/routes/monitors.ts apps/api/src/routes/my-product.ts`
      shows the gate in `/run`, `/force-rescan`, and the `/rescan` loop.
- [ ] `grep -n "isSourceAllowed" apps/api/src/routes/monitors.ts` returns nothing (used the right helper).
- [ ] `git status --porcelain` shows only the three in-scope files modified.
- [ ] `plans/README.md` status row for 003 updated.

## STOP conditions

Stop and report back (do not improvise) if:

- A handler's current code does not match the "Current state" excerpt (drift).
- `planAllowsMonitorSource` is not exported from `@outrival/shared` (import fails) — do NOT fall back
  to `isSourceAllowed`; report it.
- A new test unexpectedly 403s an internal/ungated source (`homepage`, `tech_stack`, `news`,
  `sitemap`) — that means the wrong helper or a logic error; investigate before "fixing" the test.
- The my-product `/rescan` loop structure differs enough that a single `continue` guard doesn't fit.

## Maintenance notes

- This is defense-in-depth on top of the scheduler freeze; the worker still doesn't gate source on a
  forced run, so keep the API-side gate as the enforcement point. If a future path triggers
  `scrape-monitor { force: true }` for an org-owned monitor, it must apply the same
  `planAllowsMonitorSource` check.
- Related, not fixed here: the forced-rescan daily cap is read-then-insert (non-atomic), so two
  concurrent requests can both clear the cap by a bounded amount. Low impact; fix opportunistically if
  this code is revisited (wrap count+insert in a transaction).
- A reviewer should confirm the error body (`plan_locked_source`) matches what `paywallFromError` on
  the web expects, so the paywall renders instead of a raw error.
