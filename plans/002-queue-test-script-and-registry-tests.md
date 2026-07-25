# Plan 002: `packages/queue` joins the verification graph and gets its first tests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 74888f6..HEAD -- packages/queue`
> If any file under `packages/queue` changed since this plan was written,
> compare the "Current state" excerpts against the live code before proceeding;
> on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plan 001 makes its result binding, but does not block it)
- **Category**: tests
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

`packages/queue` is the production job runtime. Since the pg-boss cutover on
2026-07-21 every background job in the system, all 37 of them, dispatches
through its 561 lines. It has **no `test` script**, so `turbo test` reports it
as `<NONEXISTENT>` and skips it. The package that replaced a managed vendor on
the most fragile subsystem in the product is the one package that cannot fail CI,
and the absence is invisible in the output: it reads as a pass.

Every other workspace has tests (scrapers 63 files, workers 22, ai 21, shared 18,
api 17, web 12, db 1). This one has zero.

Two things in it are worth pinning immediately. `syncSchedules()` **unschedules**
any cron found in the database but absent from the registry map, so a typo in a
key silently deletes a live cron. And the registry's payload types are hand-mirrored
from each job's Zod schema, with a comment admitting that a drift there is a
runtime parse error on the worker.

Adding the script matters even before the tests exist: it makes the gap visible.

## Current state

### `packages/queue/package.json` (complete, 24 lines)

```json
{
  "name": "@outrival/queue",
  "version": "0.0.1",
  "private": true,
  "exports": {
    ".": { "types": "./src/index.ts", "default": "./src/index.ts" }
  },
  "scripts": {
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@outrival/shared": "workspace:*",
    "pg-boss": "^12.26.1"
  },
  "devDependencies": { "@types/node": "^25.9.1" }
}
```

There is no `test` script. Add one.

### The package has three source files

- `packages/queue/src/boss.ts` (260 lines) — pg-boss lifecycle, `defineJob`,
  `getBoss()`, `enqueue`. Holds a module-level `registry: JobDef<never>[]` that
  every `defineJob` call pushes into.
- `packages/queue/src/jobs.ts` (282 lines) — the typed job registry: one
  `defineJob<Payload>("job-name", {...})` per job, plus `CRON_SCHEDULES` and
  `syncSchedules()`.
- `packages/queue/src/index.ts` — barrel.

### `defineJob` signature (`packages/queue/src/boss.ts:172-176`)

```ts
export function defineJob<P extends object>(name: string, config: JobConfig = {}): JobDef<P> {
  const queueOptions: Omit<Queue, "name"> = {
    policy: config.policy ?? "standard",
    retryLimit: config.retryLimit ?? 2, // = Trigger maxAttempts 3
```

`registry.push(def as unknown as JobDef<never>)` happens at the end of the same
function, so **importing `jobs.ts` populates the registry as a side effect**.
Your tests will rely on that.

### The destructive reconciler (`packages/queue/src/jobs.ts:268-282`)

`syncSchedules()` upserts every entry of `CRON_SCHEDULES`, then calls
`boss.unschedule(...)` for every schedule found in the database that is **not**
in the map. A job renamed in one place and not the other loses its cron silently.

### The hand-synced payload contract (`packages/queue/src/jobs.ts:21-23`)

```
// Payload types mirror each job's zod InputSchema in `apps/workers/src/core/*`
// ... a drift here is a runtime parse error on the worker — keep them in sync
// when a schema changes.
```

### Test conventions in this repo

Two conventions coexist, and each package's script must match where its tests live:

- `packages/shared` and `packages/scrapers` colocate tests under `src/` and run
  `bun test src`.
- `apps/*` and `packages/db` keep tests in `test/` and run `bun test test/`.

`packages/queue` has no tests yet, so pick the `src` convention to match its
sibling packages. Model the test file on
`packages/shared/src/constants/plans.test.ts`, which is a pure table test over a
constant with no I/O.

The runner is **`bun test`**. There is no vitest and no jest anywhere in this repo.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Package tests | `cd packages/queue && bun test src` | all pass |
| Whole suite | `pnpm test` | exit 0, **13** tasks (was 12) |
| Typecheck | `pnpm typecheck` | exit 0, 8 tasks |

Note: `turbo` is **not** on `PATH`. Use the `pnpm` scripts. A direct `turbo test`
prints `turbo: command not found`, and piping it hides that.

## Scope

**In scope** (the only files you should modify or create):
- `packages/queue/package.json` (add the `test` script)
- `packages/queue/src/jobs.test.ts` (create)
- `packages/queue/src/boss.test.ts` (create, only if you do step 4)

**Out of scope** (do NOT touch, even though they look related):
- `packages/queue/src/boss.ts` and `src/jobs.ts` production code. This plan adds
  tests that pin **current** behaviour. If a test fails, that is a finding to
  report, not a licence to change the source. Plan 004 is the one that changes
  queue policy.
- `turbo.json` — the `test` task already exists and is `cache: false`. Adding a
  package script is enough for turbo to pick it up.
- Any attempt to start a real pg-boss instance or connect to Postgres. These
  tests must be pure. `getBoss()` throws "Queue not started" without a
  connection, which is exactly the behaviour step 4 asserts.

## Git workflow

- Branch: `test/queue-registry-coverage` off `main`.
- Commit message style, matching `git log`: `test(queue): pin the job registry contract`.
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Add the `test` script

Edit `packages/queue/package.json` so the `scripts` block reads:

```json
  "scripts": {
    "build": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "test": "bun test src"
  },
```

**Verify**: `pnpm test 2>&1 | tail -3` reports **13** total tasks, up from 12.
At this point the queue task passes trivially (bun exits 0 with no test files),
which is fine: the package is now in the graph.

### Step 2: Pin the registry shape

Create `packages/queue/src/jobs.test.ts`. Import the registry module for its
side effect, then assert the invariants that currently hold.

Cases to write, each as its own `test(...)`:

1. **Every job name is unique.** Collect names off the registry (export a getter
   from `boss.ts` only if one already exists — if not, import the named job
   consts from `jobs.ts` and build the list from those). A duplicate name means
   two `defineJob` calls collide on one pg-boss queue.
2. **Every job name is kebab-case** (`/^[a-z0-9]+(-[a-z0-9]+)*$/`). Queue names
   reach Postgres; a stray space or capital is a runtime failure at
   `createQueue` time, not a compile error.
3. **Every `CRON_SCHEDULES` key refers to a registered job.** This is the
   `syncSchedules()` footgun: a key that matches no job is a cron that fires into
   nothing, and a job renamed without updating the map loses its schedule.
4. **Every cron expression has exactly 5 fields.** Split on whitespace and assert
   `length === 5`. pg-boss rejects a malformed expression at runtime.

**Verify**: `cd packages/queue && bun test src` → 4 tests pass.

### Step 3: Pin the payload contract at the type level

The comment at `jobs.ts:21-23` warns that the registry's payload types are
hand-mirrored from the Zod `InputSchema` of each `apps/workers/src/core/*` module,
and that a drift is a runtime parse error.

`packages/queue` does **not** depend on `apps/workers` and must not start to
(the layering rules forbid it). So do **not** import the core schemas here.
Instead, assert the shape the registry itself promises, in the same file:

- For three representative jobs (`scrape-monitor`, `classify-change`,
  `generate-signal`), write a `satisfies` type assertion that a representative
  payload literal is assignable to that job's `enqueue` parameter type.

This catches a payload type narrowed or renamed inside `packages/queue`. It does
**not** catch drift against the worker's Zod schema; that check belongs on the
workers side and is deliberately out of scope here. Say so in your report.

**Verify**: `pnpm typecheck` exits 0. A deliberate typo in one of the literals
should make it fail; undo the typo before continuing.

### Step 4 (optional): Pin the "not started" guard

`getBoss()` throws when the queue has not been started. `apps/workers`' own test
comment records that this is load-bearing: without it, `enqueue` in a test would
throw mid-assertion and fail unrelated expectations.

Create `packages/queue/src/boss.test.ts` asserting that calling `enqueue` on any
registered job **before** `start()` rejects, and that the error message names the
unstarted state rather than surfacing a driver error.

Do this only if it needs no database. If the guard cannot be reached without a
connection, skip the step and say so.

**Verify**: `cd packages/queue && bun test src` → all tests pass, still no
network or database access.

### Step 5: Full-suite check

**Verify**: `pnpm typecheck` exits 0 and `pnpm test` exits 0 with 13 tasks.

## Test plan

- New file `packages/queue/src/jobs.test.ts` covering: unique job names,
  kebab-case names, `CRON_SCHEDULES` keys all resolve to registered jobs,
  cron expressions have 5 fields, and three payload-type `satisfies` assertions.
- Optional `packages/queue/src/boss.test.ts` covering the pre-start `enqueue` guard.
- Structural pattern to copy: `packages/shared/src/constants/plans.test.ts`
  (pure table test over a constant, no I/O, no mocks).
- Verification: `cd packages/queue && bun test src` → all pass; `pnpm test` → 13 tasks, exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `packages/queue/package.json` contains `"test": "bun test src"`
- [ ] `pnpm test 2>&1 | grep -c "13 successful"` returns 1 (13 tasks, not 12)
- [ ] `cd packages/queue && bun test src` exits 0 with at least 4 tests
- [ ] `pnpm typecheck` exits 0
- [ ] `grep -rn "@outrival/workers\|apps/workers" packages/queue/src` returns no matches
      (the layering rule forbids that dependency)
- [ ] `grep -rn "DATABASE_URL\|QUEUE_DATABASE_URL" packages/queue/src/*.test.ts` returns no matches
      (tests must not reach a database)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any test you write in step 2 **fails against current code**. That means a real
  defect exists today (a duplicate queue name, a cron key with no job, a
  malformed expression). Report exactly which invariant broke and the values
  involved. Do NOT change `jobs.ts` to make the test pass; this plan is
  characterization only.
- `packages/queue/src/boss.ts` does not expose a way to enumerate the registry
  and adding one would mean changing production code. Build the list from the
  exported job consts in `jobs.ts` instead, and note it in your report.
- `bun test src` tries to open a network or database connection. Something is
  being imported transitively that starts pg-boss. Stop and report which import
  pulls it in rather than adding a mock.
- `pnpm test` reports 12 tasks after step 1. Turbo has not picked up the new
  script; report it rather than editing `turbo.json`.

## Maintenance notes

- The `CRON_SCHEDULES` test is the important one long-term. `syncSchedules()`
  unschedules anything in the database that is absent from the map, so this test
  is what stands between a rename and a silently deleted cron.
- The payload-drift risk the `jobs.ts:21-23` comment describes is **not** closed
  by this plan. Closing it needs a check on the `apps/workers` side, where both
  the registry type and the Zod schema are importable. That is a good follow-up
  and is deliberately deferred here to keep the layering rules intact.
- Plan 004 changes queue `policy` on several jobs. It will add its own tests; the
  registry tests here should keep passing unchanged, since policy is not part of
  the name/schedule contract.
- A reviewer should check that no test in this package reaches Postgres. The
  moment one does, `pnpm test` stops being runnable offline and the 31-second
  suite becomes an integration suite.
