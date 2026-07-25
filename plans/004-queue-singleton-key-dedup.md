# Plan 004: `singletonKey` actually deduplicates instead of being ignored

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- packages/queue apps/api/src/lib/queue.ts`
> If any of those changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: plans/002 (gives `packages/queue` a place for tests to run)
- **Category**: bug
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

Seven call sites across the codebase pass a `singletonKey` when enqueuing a job,
each with a comment stating it is the pg-boss replacement for Trigger.dev's
`idempotencyKey`. None of them deduplicate anything, because every queue in the
system is created with pg-boss's `standard` policy, and `standard` does not
honour `singletonKey`.

The installed pg-boss type documentation is explicit on both halves of this.
`standard` is described as supporting "deferral, priority, and throttling", and
it is the **only** policy whose description does not end with "Can be extended
with `singletonKey`". Separately, the docs for `JobMatchStrategy` name the exact
situation as a known state: more than one pre-active job sharing a key is
possible under "a manually-set key on a `standard` queue".

So every idempotency claim in the queue layer is currently fiction:

- A double `POST /api/onboarding/complete` sends two welcome digests, starts two
  onboarding-analysis watchers, and runs `aiVisibilityTeaser` twice. That last
  job is deliberately configured `retryLimit: 0` precisely so it cannot re-spend
  the free-tier AI-visibility quota, and the `singletonKey` was the other half of
  that protection.
- Duplicate `send-alert` jobs mean the same signal pages the customer twice over
  email and Slack.
- Duplicate monthly recap emails.

`apps/api/src/lib/queue.ts:38-41` documents a contract that is never satisfied:
"Returns the pg-boss job id, or null when the send was deduplicated (a
`singletonKey` collision)". It never returns null.

## Current state

### The defect (`packages/queue/src/boss.ts:172-178`)

```ts
export function defineJob<P extends object>(name: string, config: JobConfig = {}): JobDef<P> {
  const queueOptions: Omit<Queue, "name"> = {
    policy: config.policy ?? "standard",
    retryLimit: config.retryLimit ?? 2, // = Trigger maxAttempts 3
```

`JobConfig` already exposes `policy?: Queue["policy"]` (`boss.ts:149`), so the
knob exists. **No `defineJob` call in `packages/queue/src/jobs.ts` passes it**,
so all 37 queues are `standard`.

### What pg-boss says (installed `pg-boss@12.26.1`, `dist/types.d.ts:341-362`)

```
 * - `standard` supports all standard features such as deferral, priority, and
 *   throttling.
 * - `short` only allows 1 job to be queued, unlimited active. Can be extended
 *   with `singletonKey`.
 * - `singleton` only allows 1 job to be active, unlimited queued. Can be
 *   extended with `singletonKey`.
 * - `stately` offers a combination of `short` and `singleton`; only allows 1
 *   job per state, queued and/or active. Can be extended with `singletonKey`.
 * - `exclusive` only allows 1 job to be queued or active. Can be extended with
 *   singletonKey`.
```

And at `types.d.ts:306-310`, describing when duplicate keys coexist:

```
 * pre-active (created or retry) job shares that key (possible under
 * throttle/debounce or a manually-set key on a `standard` queue)
```

`singletonSeconds` (the throttle knob that would make a key deduplicate on a
`standard` queue) appears nowhere in this repo.

### The seven affected call sites

| Job enqueued | Call site | Key |
|---|---|---|
| `sendAlert` | `apps/workers/src/core/generate-signal.ts:106` | `signalId` |
| `evaluateStandingQueries` | `apps/workers/src/core/generate-signal.ts:536` | `sq-${newSignal.id}` |
| `sendMonthlyRecap` | `apps/workers/src/core/generate-daily-digest.ts:122` | `recap-${org.id}-${recapMonth}` |
| `detectReviewThemeShifts` | `apps/workers/src/core/extract-reviews.ts:90` and `:252` | `rts-${competitorId}-${snapshotId}` |
| `notifyOnboardingAnalysis` | `apps/api/src/routes/onboarding.ts:878` | `onboarding-analysis-${orgId}` |
| `aiVisibilityTeaser` | `apps/api/src/routes/onboarding.ts:896` | `ai-visibility-teaser-${orgId}` |
| `sendWelcomeDigest` | `apps/api/src/routes/onboarding.ts:909` | `welcome-digest-${orgId}` |

### The contract that lies (`apps/api/src/lib/queue.ts:38-41`)

```
 * Returns the pg-boss job id, or null when the send was deduplicated (a
 * `singletonKey` collision — the equivalent of Trigger's idempotencyKey).
```

## What this plan does and does NOT fix — read this before starting

Changing the policy makes `singletonKey` deduplicate against jobs that are
**queued or active**. It does **not** make an enqueue idempotent forever: once a
job with key `K` has *completed*, a later enqueue with key `K` creates a new job.

That is the right fix for the duplicate-in-flight problem, which is what all
seven sites actually suffer from (double click, retried request, redelivered
job). It is **not** a general "this can only ever happen once" guarantee.

Do not oversell it. Where a permanent once-only guarantee is needed, the durable
marker in the database is the mechanism (as `generate-weekly-digest` already does
with its `sentAt` check). Note in your report which of the seven sites you think
still need one; do not add them in this plan.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Queue tests | `cd packages/queue && bun test src` | all pass |
| Workers tests | `cd apps/workers && bun test test/` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Whole suite | `pnpm test` | exit 0 |

Note: `turbo` is **not** on `PATH`. Use the `pnpm` scripts; a bare `turbo ...`
prints `turbo: command not found`.

## Scope

**In scope** (the only files you should modify):
- `packages/queue/src/jobs.ts` (add `policy` to the seven job definitions)
- `packages/queue/src/jobs.test.ts` (extend; created by plan 002)
- `apps/api/src/lib/queue.ts` (only if step 4 shows the null contract is still wrong)

**Out of scope** (do NOT touch, even though they look related):
- `packages/queue/src/boss.ts`'s `?? "standard"` default. Leave `standard` as the
  default for the other 30 queues; flipping the default changes concurrency
  semantics for every job in the system at once.
- The seven call sites themselves. Their `singletonKey` values are already
  correct; the bug is entirely on the queue-definition side.
- `retryLimit`, `expireInSeconds`, `concurrency` on any queue.
- Adding `singletonSeconds`. It is a throttle window, not a dedup key, and it
  interacts with retries in a way that needs its own analysis.

## Git workflow

- Branch: `fix/queue-singleton-key-policy` off `main`.
- Commit message style, matching `git log`: `fix(queue): make singletonKey dedup`.
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Confirm the defect in the installed library

```bash
find node_modules/.pnpm -path "*pg-boss@*/dist/types.d.ts" | head -1 | xargs sed -n '340,365p'
grep -rn "policy" packages/queue/src/jobs.ts
```

**Verify**: the first prints the policy list quoted above; the second prints
nothing (no job passes `policy` today). If a job already sets `policy`, STOP.

### Step 2: Check each affected queue's concurrency before choosing its policy

This is the step that determines the risk. `exclusive` and `stately` constrain
how many jobs of that queue can be queued or active **per key**, so a queue that
relies on parallelism across *different* keys must not be over-constrained.

```bash
grep -n -A6 "defineJob" packages/queue/src/jobs.ts | grep -n "concurrency\|defineJob"
```

For each of the seven jobs, record its current `concurrency` value (or note that
it has none, meaning the pg-boss default).

**Verify**: you have a seven-row table of job name to current concurrency. Put it
in your report.

### Step 3: Set the policy on the seven jobs

Use **`stately`** for all seven unless step 2 gave you a reason not to.

Rationale to record in the code comment: `stately` allows one job per state per
key (one queued and one active), which blocks the duplicate-enqueue case while
still letting a retry of the currently-active job proceed. `exclusive` is
stricter (one job total per key) and would make a retry of an active job
impossible, which interacts badly with `retryLimit: 2`.

Add a short comment above the group explaining why these queues differ from the
default, in English, matching the file's existing comment density:

```ts
// `stately` (not the `standard` default) because these queues rely on
// `singletonKey` to deduplicate: pg-boss ignores the key on a `standard`
// queue, so the key was inert. One job per state per key blocks a duplicate
// enqueue while still allowing an active job's retry.
```

**Verify**: `pnpm typecheck` exits 0. `grep -c '"stately"' packages/queue/src/jobs.ts`
returns 7.

### Step 4: Pin the behaviour with a test

Extend `packages/queue/src/jobs.test.ts` (created by plan 002) with a test that
reads the registry and asserts: **every job that any call site enqueues with a
`singletonKey` has a policy that honours it**.

Implement it as an explicit allowlist in the test, so the assertion is readable
and a new keyed job fails until it is added deliberately:

```ts
const KEYED_JOBS = [
  "send-alert", "evaluate-standing-queries", "send-monthly-recap",
  "detect-review-theme-shifts", "notify-onboarding-analysis",
  "ai-visibility-teaser", "send-welcome-digest",
];
const HONOURS_SINGLETON_KEY = new Set(["short", "singleton", "stately", "exclusive", "key_strict_fifo"]);
```

Assert each named job's `queueOptions.policy` is in that set. Use the exact
queue names from `jobs.ts`; the table in "Current state" gives the call sites,
not necessarily the registered names, so read them from the file.

**Verify**: `cd packages/queue && bun test src` passes; temporarily reverting one
job to `standard` makes it fail; restore it.

### Step 5: Decide what to do about the `queue.ts` null contract

Read `apps/api/src/lib/queue.ts:38-41`. With the policy fixed, pg-boss returns
`null` from `send()` on a dedup collision, so the documented contract becomes
true for the keyed queues.

Check whether `enqueueJob`'s callers actually handle `null`:

```bash
grep -rn "enqueueJob" apps/api/src | head -20
```

If a caller treats a `null` return as an error, that is now a reachable path that
previously never fired. Either handle it (a dedup is a success, not a failure) or
report it. Do not leave a caller that logs an error on a successful dedup.

**Verify**: `pnpm typecheck` exits 0 and `pnpm test` exits 0.

### Step 6: Full-suite check

**Verify**: `pnpm typecheck` exits 0, `pnpm test` exits 0.

## Test plan

- Extend `packages/queue/src/jobs.test.ts`: every job in `KEYED_JOBS` has a
  policy in `HONOURS_SINGLETON_KEY`. This is the regression guard, and it is the
  one that matters: it fails the day someone adds an eighth keyed enqueue against
  a `standard` queue.
- Structural pattern to model: `packages/shared/src/constants/plans.test.ts`
  (pure table test over a constant, no I/O).
- Do **not** attempt a live pg-boss dedup test. It needs a Postgres instance and
  would turn the 31-second suite into an integration suite. Note the gap in your
  report instead.
- Verification: `cd packages/queue && bun test src` all pass; `pnpm test` exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c '"stately"' packages/queue/src/jobs.ts` returns 7
- [ ] `packages/queue/src/jobs.test.ts` contains a test asserting keyed jobs have
      a `singletonKey`-honouring policy, and it passes
- [ ] `cd packages/queue && bun test src` exits 0
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0
- [ ] `git diff --name-only` lists only files from the in-scope list
- [ ] Your report contains the seven-row concurrency table from step 2 and an
      explicit statement of which sites still need a durable once-only marker
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 2 shows one of the seven queues sets a `concurrency` above 1 **and** relies
  on processing many different keys in parallel. `stately` is per-key so this is
  usually fine, but if a queue's throughput depends on many in-flight jobs,
  confirm the semantics before constraining it.
- Changing the policy on an existing queue turns out to require dropping and
  recreating the queue in pg-boss (policy is a queue-creation property).
  **This is the most likely surprise in this plan.** If `createQueue` does not
  update an existing queue's policy, the change is inert until the queue is
  recreated on the production box. Report exactly what is needed as a deploy
  step; do NOT write a migration or a queue-dropping script yourself.
- Any existing test in `apps/workers/test/` fails after the change. Those tests
  mock `enqueue`, so they should be unaffected; a failure means something reaches
  the real registry and should be understood, not patched around.
- You find a caller of `enqueueJob` that treats `null` as a failure and you
  cannot tell whether a dedup should be logged as an error there. Report it.

## Maintenance notes

- **The deploy-time caveat is the thing to watch in review.** pg-boss applies
  queue options at `createQueue` time. If the production queue already exists
  with `policy: standard`, this change may not take effect until that queue is
  recreated. The reviewer should insist on an explicit answer to "what makes this
  live in production", not just "typecheck is green".
- This plan fixes duplicate-in-flight, not once-ever. `send-alert` in particular
  still sends then records (its `alerts` row is written after the Slack and email
  calls), so a database blip between the two re-sends on retry. That is a
  separate finding and a separate plan; the two together are what make alerting
  genuinely at-most-once.
- When adding a new job that passes `singletonKey`, add it to `KEYED_JOBS` in the
  test and give its queue a non-`standard` policy in the same change. The test
  exists to make that impossible to forget.
- `apps/api/src/lib/queue.ts`'s docstring should end up describing behaviour that
  is now real. If you changed it, say what it says now.
