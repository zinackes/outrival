# Plan 006: Five live worker modules stop throwing their log lines away

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- apps/workers/src/lib`
> If any file under `apps/workers/src/lib` changed since this plan was written,
> compare the "Current state" excerpts against the live code before proceeding;
> on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

Job execution moved from Trigger.dev to self-hosted pg-boss on 2026-07-21. All 37
job bodies now live in `apps/workers/src/core/` and run inside the pg-boss worker
process. Trigger.dev's `logger` only writes anything when it is called inside a
Trigger run: outside one, its `LoggerAPI` falls back to a `NoopTaskLogger` whose
`debug`, `log`, `info`, `warn` and `error` methods all have empty bodies.

Five modules under `apps/workers/src/lib/` that are reached from live pg-boss
handlers still import that logger. Since the cutover, **18 log statements have
been writing to nothing in production.**

The worst of them is `analytics.ts:31` and `:39`. Those two lines are the only
error surface of `bestEffort` and `bestEffortRead`, the wrappers that swallow
failures for every analytics write in the system: `signal_feed`, `scrape_runs`,
`ai_runs`, `extraction_runs`, `backfill_runs`, `numeric_claims`,
`platform_detection_runs`, `review_scores`, `pricing_history` and more. Those
writes are best-effort **by design**, so they never throw. Their only signal that
anything is wrong is that log line. Analytics could be failing completely right
now and nothing would show it: not the logs, not Sentry (the error is swallowed,
never thrown), not the dashboards (which read the same empty tables).

The fix is a one-line import swap per file, because the neutral shim built for
exactly this purpose already mirrors Trigger's API.

## Current state

### The five files, and what each currently imports

```
apps/workers/src/lib/analytics.ts:1              import { logger } from "@trigger.dev/sdk/v3";   (2 calls)
apps/workers/src/lib/staged-extract.ts:3         import { logger } from "@trigger.dev/sdk/v3";   (2 calls)
apps/workers/src/lib/platform-detect.ts:2        import { logger } from "@trigger.dev/sdk/v3";   (5 calls)
apps/workers/src/lib/slo-first-signal.ts:1       import { logger } from "@trigger.dev/sdk/v3";   (1 call)
apps/workers/src/lib/ai-visibility/engines.ts:1  import { logger } from "@trigger.dev/sdk/v3";   (8 calls)
```

Three more files import the same SDK, and are **deliberately out of scope**:
`apps/workers/src/lib/queues.ts`, `lib/scrape-queues.ts` and `lib/trigger-adapter.ts`
exist only to serve the Trigger wrappers and are removed wholesale by a later
plan. Do not touch them here.

### The two silenced lines that matter most (`apps/workers/src/lib/analytics.ts:27-40`)

```ts
    logger.error(`analytics ${op} failed`, { err: String(err) });
```

appears twice, once in `bestEffort` and once in `bestEffortRead`.

### Why it is a no-op (verified in the installed SDK)

`node_modules/.pnpm/@trigger.dev+core@4.4.6/.../v3/logger/index.js:7`

```js
const NOOP_TASK_LOGGER = new taskLogger_js_1.NoopTaskLogger();
```

`.../v3/logger/taskLogger.js:85-97`

```js
class NoopTaskLogger {
    debug() { }
    log() { }
    info() { }
    warn() { }
    error() { }
    ...
}
```

`LoggerAPI` resolves its task logger as `getGlobal("logger") ?? NOOP_TASK_LOGGER`.
Nothing registers a global logger in the pg-boss worker, so every call no-ops.

### The replacement already exists and is API-compatible

`apps/workers/src/lib/job-logger.ts` (complete file):

```ts
import { logger as base } from "@outrival/shared";

// Trigger.dev's `logger` is message-first (`logger.log("msg", { meta })`); the
// neutral @outrival/shared logger is pino-style object-first (`info({ meta }, "msg")`).
// This shim exposes the Trigger surface on top of the neutral logger so a job body
// can move from Trigger's runtime into a pg-boss core handler with its log calls
// UNCHANGED — only the import line swaps. Outlives the Trigger cutover: the core
// bodies keep calling it.
type Meta = Record<string, unknown>;

export const logger = {
  log:   (message: string, metadata?: Meta) => base.info(metadata ?? {}, message),
  info:  (message: string, metadata?: Meta) => base.info(metadata ?? {}, message),
  warn:  (message: string, metadata?: Meta) => base.warn(metadata ?? {}, message),
  error: (message: string, metadata?: Meta) => base.error(metadata ?? {}, message),
  debug: (message: string, metadata?: Meta) => base.debug(metadata ?? {}, message),
  trace: (message: string, metadata?: Meta) => base.debug(metadata ?? {}, message),
};
```

**This is the single most important fact in this plan**: the shim is
message-first, exactly like Trigger's logger. So the 18 call sites need **no
argument reordering**. Only the import line changes. All 38 files in
`apps/workers/src/core/` already use this shim; these five `lib/` modules were
simply missed.

### Import paths you will need

- from `apps/workers/src/lib/analytics.ts` → `./job-logger`
- from `apps/workers/src/lib/staged-extract.ts` → `./job-logger`
- from `apps/workers/src/lib/platform-detect.ts` → `./job-logger`
- from `apps/workers/src/lib/slo-first-signal.ts` → `./job-logger`
- from `apps/workers/src/lib/ai-visibility/engines.ts` → `../job-logger` (one level deeper)

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Workers tests | `cd apps/workers && bun test test/` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Whole suite | `pnpm test` | exit 0 |

Note: `turbo` is **not** on `PATH`. Use the `pnpm` scripts.

## Scope

**In scope** (the only files you should modify):
- `apps/workers/src/lib/analytics.ts` (line 1)
- `apps/workers/src/lib/staged-extract.ts` (line 3)
- `apps/workers/src/lib/platform-detect.ts` (line 2)
- `apps/workers/src/lib/slo-first-signal.ts` (line 1)
- `apps/workers/src/lib/ai-visibility/engines.ts` (line 1)

Exactly five lines. Nothing else.

**Out of scope** (do NOT touch, even though they look related):
- `apps/workers/src/lib/queues.ts`, `lib/scrape-queues.ts`, `lib/trigger-adapter.ts`
  — Trigger-wrapper-only, deleted by a later plan.
- The 18 log call sites themselves. The shim is API-compatible; changing the
  arguments would be a needless diff and risks introducing the pino/Trigger
  argument-order bug this shim exists to avoid.
- `apps/workers/src/lib/job-logger.ts`. It is correct as-is.
- Removing `@trigger.dev/sdk` from `apps/workers/package.json`. Other files still
  import it; that removal belongs to the Trigger-teardown plan.
- Any refactor of `analytics.ts` (it is 1040 lines and a known god-module). Not now.

## Git workflow

- Branch: `fix/worker-libs-neutral-logger` off `main`.
- Commit message style, matching `git log`: `fix(workers): restore lost lib logs`.
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Confirm the five files and the no-op mechanism

```bash
grep -rn 'from "@trigger.dev/sdk/v3"' apps/workers/src/lib/
find node_modules/.pnpm -path "*@trigger.dev+core*/dist/commonjs/v3/logger/taskLogger.js" \
  | head -1 | xargs sed -n '85,97p'
```

**Verify**: the first lists eight files (the five in scope plus the three
wrapper-only ones); the second prints the `NoopTaskLogger` class with empty
method bodies.

### Step 2: Swap the five imports

Change each file's import line to pull `logger` from the shim, keeping the
relative depth correct (`./job-logger` for four of them, `../job-logger` for
`ai-visibility/engines.ts`).

Do **not** change any call site.

**Verify**: `grep -rn 'from "@trigger.dev/sdk/v3"' apps/workers/src/lib/` now
lists only the three wrapper-only files.

### Step 3: Confirm no call site needed changing

```bash
pnpm typecheck
```

**Verify**: exits 0. Because the shim's signature is `(message, metadata?)`,
identical to Trigger's, a green typecheck is strong evidence that all 18 call
sites are compatible. If typecheck fails on an argument shape, STOP: something
about the shim differs from what this plan describes.

### Step 4: Prove a log line now actually emits

A green typecheck proves compatibility, not that output appears. Add one focused
test rather than trusting it.

Write a test that calls the shim's `error` with a message and metadata and
asserts the underlying `@outrival/shared` logger received them, with the message
as the message and the metadata as the bindings (the pino order, which the shim
is responsible for flipping).

Put it where `apps/workers`' script will run it: `apps/workers/test/`
(the package runs `bun test test/`). Model it on an existing pure test in that
directory.

Be careful with mocking: Bun's `mock.module` is process-global, and
`apps/workers/test/classify-change-gate.test.ts` documents a past incident where
mocking a module wholesale broke another test file by dropping the module's
other exports. Prefer a test that does not `mock.module` at all: if the shim
cannot be tested without mocking `@outrival/shared`, assert instead that the five
files no longer import the Trigger SDK (a grep-style structural test), and say so
in your report.

**Verify**: `cd apps/workers && bun test test/` passes, and no other test file in
that directory starts failing (run the whole directory, not just your file).

### Step 5: Full-suite check

**Verify**: `pnpm typecheck` exits 0 and `pnpm test` exits 0.

## Test plan

- One new test in `apps/workers/test/` asserting either (a) the shim forwards
  message and metadata to the neutral logger in pino order, or (b) as a fallback,
  that no file in `apps/workers/src/lib/` outside the three wrapper-only files
  imports `@trigger.dev/sdk`. Option (b) is the durable regression guard and is
  worth having either way.
- Structural pattern: an existing pure test in `apps/workers/test/`. Avoid
  `mock.module` for the reason above.
- Verification: `cd apps/workers && bun test test/` all pass (whole directory,
  to catch a mock leak); `pnpm test` exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rln 'from "@trigger.dev/sdk/v3"' apps/workers/src/lib/ | wc -l` returns 3
      (only `queues.ts`, `scrape-queues.ts`, `trigger-adapter.ts`)
- [ ] `grep -c 'job-logger' apps/workers/src/lib/analytics.ts` returns 1
- [ ] `git diff --stat` shows exactly 5 files changed, 5 insertions, 5 deletions
      (one import line each, no call-site edits)
- [ ] A test guarding the regression exists and passes
- [ ] `cd apps/workers && bun test test/` exits 0
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `pnpm typecheck` fails after the swap with an argument-shape error. That means
  the shim is not the drop-in this plan claims. Report the exact error; do not
  start reordering arguments across 18 call sites.
- Your `git diff --stat` shows more than 5 changed lines. Something edited call
  sites; revert and redo the import lines only.
- Adding your test makes an unrelated file in `apps/workers/test/` fail. That is
  the process-global `mock.module` leak. Drop the mocking approach and use the
  structural test instead.
- You discover a sixth live `lib/` module importing the Trigger logger that this
  plan does not list. Report it and include it, noting the addition.

## Maintenance notes

- **This is a prerequisite for removing Trigger.dev entirely.** The teardown plan
  cannot drop `@trigger.dev/sdk` from `apps/workers` while live modules import it.
  Land this first.
- **Expect new log volume after deploy, and treat it as the point.** Eighteen
  statements that have been silent since 2026-07-21 start emitting. If
  `analytics.ts`'s "analytics ... failed" line appears at any real rate, that is a
  genuine, previously-invisible production problem surfacing, not a regression
  from this change. Say so in the pull-request description so nobody rolls it back.
- The durable guard is the structural test: no `@trigger.dev/sdk` import outside
  the wrapper files. Once the wrappers are deleted, tighten it to "nowhere in
  `apps/workers/src`" and it becomes a permanent boundary.
- Worker-side change: it reaches production only when the worker image is rebuilt
  and the two worker services are pulled and restarted. A green CI run does not
  mean it is live.
