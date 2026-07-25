# Plan 024: Find where 80% of archive backfills are lost between enqueue and execution, then stop losing them

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report, do not improvise. This plan is **diagnose-then-fix**: step 3 decides
> which fix applies, and the wrong fix applied confidently is worse than none.
> When done, update the status row for this plan in `plans/README.md`, unless a
> reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- packages/queue/src/jobs.ts apps/workers/src/core/scrape-monitor.ts apps/workers/src/core/backfill-history.ts apps/workers/src/queue`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (changes a job's delivery semantics on the production queue)
- **Depends on**: plans/019-first-signal-miss-buckets.md (DONE, supplied the evidence)
- **Category**: bug
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

The archive backfill is the only mechanism that can produce a signal on day 0. It
is what makes the first-signal SLO achievable at all
(`docs/slos/onboarding-first-signal.md:21-23`). Plan 019 measured the SLO at **27%
compliance against a 70% target** over the 28 days to 2026-07-25, and attributed
**14 of 16 missed onboardings** to the bucket `no_backfill_run`: no backfill ever
ran for any of those organizations' competitors.

Production measurement, same window, is unambiguous about where the loss is:

| Fact | Value |
|---|---|
| Competitors created (non-self, not deleted) | 109 |
| ...of which have a `homepage` or `pricing` snapshot | 105 |
| ...of which have **any** `backfill_runs` row, ever | **21** |

So 84 first captures out of 105 produced no backfill row. Four things are already
ruled out by measurement, so do not re-investigate them:

- **Not an onboarding-flow problem.** Zero of the 16 missed orgs had zero competitors.
- **Not a measurement window artifact.** Repeating the lookup unbounded (no 28-day
  bound on `backfill_runs`) still gives 14 of 16 orgs with no backfill row *ever*.
- **Not re-onboarding.** Zero of the missed orgs had more than one onboarding session,
  and zero had competitors predating their completion by a day or more.
- **Not a broken backfill job.** When it does run it works and it is fast: across
  competitors created in the last 90 days, the median lag from competitor creation to
  the first `backfill_runs` row is **1.0 minute**. In the same 28 days the job wrote
  23 `change_triggered`, 7 `no_archive_capture` and 1 `no_significant_change`.

The enqueue site is unconditional for a first capture and there is no early return
between the snapshot insert and the enqueue (verified: `awk` over lines 1000 to 1790
of `scrape-monitor.ts` finds no `return` or `AbortTaskRunError`). The handler is
registered. So the loss sits **between the enqueue and the handler running**, and it
is silent: nothing logs it, which is why it went unnoticed for a month.

## Current state

### The enqueue site (correct, do not change in step 1)

`apps/workers/src/core/scrape-monitor.ts:1784-1798`:

```ts
    // L2 archive backfill — fire once, on the first-ever capture of a backfillable
    // source for a real competitor. Reuses this fresh snapshot as the diff's
    // "after" side (race-free: it's already committed). Best-effort, never blocks.
    if (
      !lastSnapshot &&
      competitor.type !== "self" &&
      BACKFILL_ENABLED &&
      BACKFILL_SOURCES.includes(monitor.sourceType)
    ) {
      await backfillHistory.enqueue({
        monitorId: monitor.id,
        competitorId: competitor.id,
        sourceType: monitor.sourceType,
      });
    }
```

With, at `apps/workers/src/core/scrape-monitor.ts:118-122`:

```ts
const BACKFILL_ENABLED = process.env.BACKFILL_ENABLED !== "false";
const BACKFILL_SOURCES = (process.env.BACKFILL_SOURCES ?? "homepage,pricing")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
```

### The prime suspect

`packages/queue/src/jobs.ts:158-163`:

```ts
// L2 archive backfill (Wayback). Event-triggered from scrape-monitor's first
// capture; never retried (archive inserts aren't idempotent), politely throttled.
export const backfillHistory = defineJob<BackfillHistoryPayload>("backfill-history", {
  retryLimit: 0,
  expireInSeconds: 300,
});
```

`retryLimit: 0` plus `expireInSeconds: 300` means: a job that does not start within
5 minutes of being enqueued is expired by pg-boss and **never runs, never retries,
and writes no `backfill_runs` row**. Combined with the fan-out shape the codebase
documents for onboarding, that predicts exactly the observed ratio.

The fan-out is documented at `apps/workers/src/lib/queues.ts:19-21`:

```ts
// Onboarding /complete fires every competitor's homepage scrape at once, so this
// job fans out N-wide within seconds.
```

and the backfill lane is deliberately slow, `apps/workers/src/lib/queues.ts:12-18`:

```ts
// L2 archive backfill hits the Internet Archive (a shared free resource). Keep a
// low ceiling so a batch of onboarding backfills (one per competitor × source)
// can't hammer it — each job is already sequential + ~1 req/s internally.
export const backfillQueue: Queue = queue({
  name: "backfill",
  concurrencyLimit: 2,
});
```

**Important caveat about that file**: it imports `queue` from `@trigger.dev/sdk/v3`,
so on the pg-boss execution path these `Queue` objects may be inert configuration.
Do not assume the concurrency limit of 2 is what production enforces. Establishing
whether it is, is part of step 2. The `retryLimit` / `expireInSeconds` on the job
definition, by contrast, are pg-boss options and are live.

### The handler is registered (so "not wired up" is ruled out)

`apps/workers/src/queue/handlers.ts:112-130` registers `backfillHistory` under the
`light` role:

```ts
  if (role === "light") {
    ...
    await on(backfillHistory, runBackfillHistory);
```

Worker roles, `apps/workers/src/queue/handlers.ts:92-97`:

```
//   browser — the jobs that launch Chromium or render a PDF (scrape-monitor,
//             detect-platform, generate-battle-card).
//   light   — everything else: crons, AI lane, extracts, digests, alerts.
```

Note the consequence: **`scrape-monitor` runs on the browser worker and enqueues a
job the light worker must consume.** If the light worker is down, restarting, or
saturated while an onboarding burst lands, every backfill in that burst expires
after 5 minutes with no trace.

### Where the outcome rows come from

`apps/workers/src/core/backfill-history.ts:73-77` logs via `logBackfillRun`, and
`apps/workers/src/lib/backfill-guard.ts:47-65` resolves the bucket. A row is written
only once the handler **runs**. An expired job produces nothing, which is why the
`no_backfill_run` bucket from plan 019 is accurate but uninformative about the cause.

### Conventions that apply

- **Jobs must be idempotent** (`.claude/rules/jobs.md`). The current comment says
  archive inserts are not idempotent, which is the stated reason for `retryLimit: 0`.
  Any change to retry semantics has to reckon with that, not ignore it. That tension
  is the heart of this plan: see step 4.
- **Never swallow an error silently** (`.claude/rules/typescript.md`). The current
  failure mode is the purest form of silent swallow: the job never runs and nothing
  anywhere records that it did not.
- **Analytics writes are best-effort** and must never break a scrape
  (`apps/workers/src/lib/analytics.ts`). Any new logging follows that.
- **Worker changes need a deploy to take effect.** A green CI run does not make this
  live; the worker image must be rebuilt and both worker services restarted. Say so
  in the PR body.
- English only in code, comments and any user-visible string. No em-dashes in prose
  you write; rephrase instead of substituting a hyphen.

## Commands you will need

| Purpose       | Command                                 | Expected on success |
|---------------|-----------------------------------------|---------------------|
| Typecheck     | `pnpm typecheck`                        | exit 0, 8 tasks     |
| Tests         | `pnpm test`                             | exit 0, all pass    |
| Queue tests   | `pnpm --filter @outrival/queue test`    | exit 0 (may not exist yet, see plan 002) |

**Environment gotcha**: `turbo` is not on `PATH`; a bare `turbo typecheck` prints
`turbo: command not found` and reads as silence when piped. Use the `pnpm` scripts.

**Do not run `pnpm build`**: a full web build exhausts RAM on the WSL2 dev box.

## Scope

**In scope**:
- `packages/queue/src/jobs.ts` (the `backfillHistory` definition, step 4)
- `apps/workers/src/core/scrape-monitor.ts` (enqueue-site logging only, step 1)
- `apps/workers/src/core/backfill-history.ts` (a start-of-run marker only, step 1)
- `packages/db/src/schema/analytics.ts` **only if** step 3 concludes a new outcome
  value is needed, and only as a comment change (the column is free text)
- `docs/slos/onboarding-first-signal.md` (record the cause, step 5)
- One test file under `apps/workers/test/` or `packages/queue/test/`, matching
  whichever already exists

**Out of scope** (do NOT touch):
- `apps/workers/src/lib/queues.ts` — those are Trigger.dev `Queue` objects on a
  runtime being retired. Changing them changes nothing on pg-boss and creates the
  false impression that it did. If the concurrency ceiling turns out to matter, say
  so in step 5 and leave it to the queue migration.
- The scrape cascade, robots handling, or anything in `packages/scrapers`.
- `apps/workers/src/lib/slo-first-signal.ts` and the admin readout from plan 019.
- Onboarding, `classify-change`, `generate-signal`. This plan fixes delivery of one
  job; it does not touch the signal chain.
- Raising `BACKFILL_LOOKBACK_DAYS` or widening `BACKFILL_SOURCES`. Coverage tuning is
  a different question and the measurement says coverage is not the problem.

## Git workflow

- Branch: `advisor/024-backfill-delivery`
- Conventional Commits, subject at most 50 chars, imperative. Example from
  `git log`: `fix(signals): ...`. Suggested: `fix(queue): stop dropping archive backfills`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Make the loss visible before changing anything

Right now an enqueued-but-never-run backfill leaves no trace anywhere. Close that
first, so the fix in step 4 can be proven rather than assumed.

1. At the enqueue site (`scrape-monitor.ts:1793`), log one line after a successful
   enqueue, at info level, with `monitorId`, `competitorId` and `sourceType`. Use the
   module's existing logger import; do not introduce a new logging library.
2. At the top of `runBackfillHistory` (`backfill-history.ts`), before any work, log
   one line with the same three fields.

The pair gives a countable enqueued-versus-started ratio in the worker logs, which is
the single number this plan exists to move.

Do **not** add a database row for "enqueued". `backfill_runs` is the outcome table
and an enqueue is not an outcome; a synthetic row would corrupt the plan 019 buckets.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Read the queue's own record of what happened

pg-boss keeps job state in its dedicated database (`QUEUE_DATABASE_URL`, the
always-on Postgres, **never** Neon). Expired and failed jobs are rows there.

Ask the operator to run, against `QUEUE_DATABASE_URL`:

```sql
SELECT name, state, count(*)
FROM pgboss.job
WHERE name = 'backfill-history' AND created_on >= now() - interval '28 days'
GROUP BY 1, 2
ORDER BY 3 DESC;
```

and the same against `pgboss.archive` (pg-boss moves completed and failed jobs there
after their retention window; the exact table name may differ by pg-boss major
version, so confirm with `\dt pgboss.*` first).

You are looking for the state that accounts for roughly 84 jobs: `expired`,
`failed`, `cancelled`, or `created` still sitting unclaimed.

If you cannot reach `QUEUE_DATABASE_URL`, STOP and report. Do not skip to step 4 on
the hypothesis alone; the whole point of this step is that the fix depends on which
state it is.

**Verify**: you have a state breakdown written down, and one state accounts for the
bulk of the missing jobs.

### Step 3: Decide which fix the evidence supports

Match the dominant state from step 2 to its fix. Write the mapping down before
editing anything.

- **`expired` dominant** → the jobs waited longer than `expireInSeconds: 300` and
  were discarded. Fix in step 4a.
- **`failed` dominant** → the handler ran and threw before its first log. With
  `retryLimit: 0` that is terminal and silent. Fix in step 4b: the handler must log
  its failure into `backfill_runs` with outcome `error`, which
  `apps/workers/src/core/backfill-history.ts` already has a bucket for.
- **`created` dominant and still unclaimed** → the light worker is not consuming this
  queue at all in production. That is a deployment problem, not a code problem. STOP
  and report it: the fix is operational (worker role, restart, deploy state), and
  shipping a code change would mask it.
- **No dominant state, or the rows are gone** (retention already purged them) → STOP
  and report. Re-run the count after step 1 is deployed and a week of data exists.

**Verify**: the mapping is written into the plan's eventual PR description.

### Step 4a: If jobs expire, give the lane a deadline it can meet

Two levers, and the tension between them is real, so reason about it rather than
turning both up:

- `expireInSeconds` is how long pg-boss lets the job *start*. Raising it to cover an
  onboarding burst is the direct fix. Size it from step 2's data: the observed worst
  queue wait, with headroom. Do not pick a round number without that measurement.
- `retryLimit: 0` exists because "archive inserts aren't idempotent"
  (`packages/queue/src/jobs.ts:158-159`). Verify that claim against
  `apps/workers/src/core/backfill-history.ts` before touching it. If the job is in
  fact safe to retry (for example because it checks for an existing archive snapshot
  first), say so with the file and line, and only then consider a retry. If it is not
  safe, **leave `retryLimit: 0` alone** and fix the expiry only. A retry that
  double-inserts archive snapshots would corrupt the diff baseline for every affected
  competitor, which is far worse than a missed backfill.

Whatever you change, update the comment above the definition to say what the new
number is for. A magic number with a stale comment is how this bug was born.

**Verify**: `pnpm typecheck` → exit 0, `pnpm test` → exit 0.

### Step 4b: If jobs fail, make the failure land in the outcome table

`runBackfillHistory` already resolves outcomes through `resolveBackfillOutcome` and
`docs/architecture.md` documents an `error` bucket for `backfill_runs.outcome`. Wrap
the handler body so that a throw is recorded with `outcome = 'error'` and a `detail`
carrying the error message, then rethrows or returns per the job's existing
contract. Keep the write best-effort: a logging failure must not change the job's
outcome.

**Verify**: `pnpm typecheck` → exit 0, `pnpm test` → exit 0.

### Step 5: Write down the cause and the expected recovery

Append a short dated subsection to the `## Miss attribution review, 2026-07-25`
section that plan 019 added to `docs/slos/onboarding-first-signal.md`. It must say:

1. The state breakdown from step 2.
2. The cause in one sentence.
3. What changed, and the number chosen with its justification.
4. **The expected effect on the SLI, as a prediction with a date.** The current
   value is 27%. State what compliance you expect at the next 28-day window and when
   to check. A fix with no predicted number cannot be falsified, and this SLO already
   has one unfalsified assumption in its history (the doc's original ~65% ceiling was
   computed against coverage, when the binding constraint was delivery).

Do **not** change the 70% target. Recalibration has its own gate
(`docs/slos/onboarding-first-signal.md:29`).

**Verify**: `grep -n "backfill delivery" docs/slos/onboarding-first-signal.md` returns
one match (use that phrase in your subsection heading).

## Test plan

- One test for whatever step 4 changed:
  - For 4a, a test asserting the `backfillHistory` job definition carries the new
    `expireInSeconds` and still carries `retryLimit: 0` (a guard so a later refactor
    cannot silently re-enable retries on a non-idempotent job). Put it wherever
    `packages/queue` tests live; if that package has no test script yet, plan 002
    adds one, so either land after it or place the test in `apps/workers/test/`.
  - For 4b, a test that a throwing handler body still writes an `error` row.
- Model it structurally on an existing test in the same directory; do not invent a
  new harness.
- Verification: `pnpm test` → exit 0, including the new case.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0, with the new case passing
- [ ] Both log lines from step 1 exist, and a grep shows the enqueue-side and
      start-side lines carry the same three fields
- [ ] The step 2 state breakdown is recorded in the PR description
- [ ] `docs/slos/onboarding-first-signal.md` carries a "backfill delivery" subsection
      with the cause, the change, and a **dated numeric prediction** for the SLI
- [ ] `apps/workers/src/lib/queues.ts` is **unmodified**
- [ ] `git status` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row for 024 updated

## STOP conditions

Stop and report back (do not improvise) if:

- You cannot reach `QUEUE_DATABASE_URL` to complete step 2.
- Step 2 shows `created` as the dominant state: the fix is operational, not code.
- Step 2's rows have already been purged by pg-boss retention, leaving no evidence.
- You conclude `retryLimit: 0` should be raised, but cannot point to a specific line
  in `apps/workers/src/core/backfill-history.ts` proving the job is safe to re-run.
  A double-inserted archive snapshot poisons the diff baseline permanently; a missed
  backfill only costs one day-0 signal.
- The enqueue site at `scrape-monitor.ts:1784-1798` does not match the excerpt.
- The fix appears to require touching `scrape-monitor`'s diff or signal logic. It
  should not; the enqueue is already correct.

## Maintenance notes

- **This job crosses worker roles**: `scrape-monitor` runs on `browser` and enqueues
  onto a queue consumed by `light`. Any future job with that shape inherits the same
  failure mode, and the same silence. It is worth asking, in review, whether
  `expireInSeconds` on cross-role jobs deserves a shared floor rather than a
  per-job guess.
- **The deploy is the fix.** Worker code changes do not take effect on a green CI
  run; both worker services need a rebuilt image and a restart. The `plans/` path is
  on the deploy workflow's deny-list, so writing plans never triggers one, but this
  plan's code changes will.
- Once this lands, plan 019's `/admin/onboarding` miss-attribution card is the
  instrument that shows whether it worked: `no_backfill_run` should collapse and the
  remaining misses should move into `no_archive_capture` or `no_significant_change`,
  which is the coverage question the SLO doc originally expected to be facing.
- Deliberately deferred: whether the backfill lane's concurrency ceiling of 2 is
  enforced at all on pg-boss (`apps/workers/src/lib/queues.ts` still imports from the
  Trigger SDK). That belongs to the queue migration, not here.
