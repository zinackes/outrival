# Plan 025: The dead-letter tile reports the real depth, and something pages when it grows

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If any
> STOP condition occurs, stop and report, do not improvise. When done, update the
> status row for this plan in `plans/README.md`, unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- apps/api/src/lib/queue-admin.ts apps/api/src/routes/admin/system.ts apps/web/src/app/\(admin\)/admin/page.tsx apps/workers/src/core/ops-health-check.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

`outrival-dlq` is the shared dead-letter sink for the four jobs that make up the
critical scrape-to-signal pipeline: `scrape-monitor`, `classify-change`,
`generate-signal`, `send-alert`. A job that exhausts its retries lands there and
stops existing as far as the product is concerned.

Measured on the production queue database on 2026-07-25:

```
outrival-dlq | created | 602
```

602 jobs, in state `created`, unclaimed. The `/admin` overview has a "Dead letter"
tile for exactly this. **It displays `25`.**

The cause is a one-line conflation: the endpoint asks for a capped *list* of rows
and then reports the list's length as the count. `DLQ_CAP` is 25, so the tile has
read 25 for as long as the queue has been deeper than 25, and it will keep reading
25 at 6,000. The tone is already red, so the operator sees a red tile with a small
number next to it, which reads as a trickle to clear later rather than a pipeline
losing work by the hundred.

The second half is that nothing pushes. `ops-health-check` runs every 6 hours and
alerts on scrape health, AI health and signal volume; it does not read the
dead-letter depth at all. So the only way to learn the real number is to open
`/admin/system`, notice the capped list, and go query the queue database by hand.
That is how the 602 was found, by accident, on a different investigation.

This plan makes the number true and makes it push. It deliberately does **not**
redrive the 602: that decision depends on step 1's answer and carries its own blast
radius (see "Out of scope").

## Current state

### The count that lies

`apps/api/src/lib/queue-admin.ts:216-238` returns rows, capped:

```ts
/** Contents of the shared dead-letter queue — jobs that exhausted their retries. */
export async function listDeadLetter(limit = 50): Promise<
  (JobRow & { sourceQueue: string | null; payload: unknown })[] | null
> {
  return sql(
    `select id::text,
            name as "taskIdentifier",
            ...
       from pgboss.job
      where name = 'outrival-dlq'
      order by created_on desc
      limit $1`,
    [limit],
  );
}
```

`apps/api/src/routes/admin/system.ts:25,47,77-81` turns that list length into the
count the whole UI trusts:

```ts
const DLQ_CAP = 25;
...
  const deadLetterRows = configured ? await listDeadLetter(DLQ_CAP) : null;
...
    deadLetter: {
      available: deadLetterRows !== null,
      count: deadLetterRows?.length ?? 0,
      rows: deadLetterRows ?? [],
    },
```

`apps/web/src/app/(admin)/admin/page.tsx:82,138-144` renders it:

```tsx
  const deadLetterCount = queue?.deadLetter.count ?? 0;
...
          <HealthTile
            href="/admin/system"
            label="Dead letter"
            value={queue ? String(deadLetterCount) : "—"}
            tone={deadLetterCount > 0 ? "bad" : queue ? "ok" : "neutral"}
            hint="jobs exhausted retries"
          />
```

Note the sibling fields in the same payload are honest: `totalQueued`,
`totalRunning` and `totalFailed` (`system.ts:40-42`) are summed from pg-boss's own
counters, not from a capped list. Only the dead-letter count takes the shortcut.
The `failures24h` block right above it at least admits the truncation with a
`capped` boolean (`system.ts:58-63`); the dead-letter block does not even do that.

### What routes into it

`packages/queue/src/jobs.ts:15-18`:

```ts
// Shared dead-letter sink for the critical scrape→signal pipeline. Jobs that
// exhaust retries land here for inspection / redrive; no worker consumes it.
const PIPELINE_DLQ = "outrival-dlq";
export const deadLetterQueue = defineJob<Record<string, never>>(PIPELINE_DLQ);
```

and four jobs carry `deadLetter: PIPELINE_DLQ` (`jobs.ts:87-106`): `scrape-monitor`,
`classify-change`, `generate-signal`, `send-alert`. "No worker consumes it" is the
intended design, not a bug. The bug is that the inspection half was built and the
measurement half was not.

### Where the alert belongs

`apps/workers/src/core/ops-health-check.ts` already collects alerts into an array
and sends one Slack message at the end (lines 141-146):

```ts
    if (alerts.length > 0) {
      const text = `*Outrival ops health*\n${alerts.join("\n")}`;
      // sendSlackMessage is silent when the webhook is unset/down — never throws.
      await sendSlackMessage(process.env.OPS_SLACK_WEBHOOK_URL ?? "", text);
      logger.warn("Ops health alerts fired", { count: alerts.length, alerts });
    }
```

Each check is wrapped in its own `try/catch` that logs and continues (see the
first-signal SLO block at lines 126-139 for the exact shape to copy). `grep -c
"deadLetter\|dlq"` over that file returns **0** today.

The worker cannot import from `apps/api`, so it needs its own read. Check whether
the workers have a queue-side helper before writing SQL: `packages/queue` is
importable from workers (`.claude/rules/monorepo.md`), and `getBoss()` exposes
pg-boss's own queue counters.

### Conventions that apply

- **Best-effort, never fatal.** Every ops-health check catches its own errors and
  the run continues. A queue-database hiccup must not break the cron.
- **The queue lives on its own Postgres.** `system.ts:32-34` records the rule: each
  section degrades to `available: false` independently rather than 500ing the page.
- **Hono handlers respond JSON, never throw naked** (`apps/api/CLAUDE.md`).
- English only for anything user-visible. No em-dashes in prose you write.

## Commands you will need

| Purpose   | Command                            | Expected on success |
|-----------|------------------------------------|---------------------|
| Typecheck | `pnpm typecheck`                   | exit 0, 8 tasks     |
| Tests     | `pnpm test`                        | exit 0, all pass    |

**Environment gotcha**: `turbo` is not on `PATH`; a bare `turbo typecheck` prints
`turbo: command not found` and reads as silence when piped. Use the `pnpm` scripts.
**Do not run `pnpm build`**: it exhausts RAM on the WSL2 dev box.

## Scope

**In scope**:
- `apps/api/src/lib/queue-admin.ts` (add a count function)
- `apps/api/src/routes/admin/system.ts` (use it)
- `apps/web/src/lib/api.ts` (the `deadLetter` type)
- `apps/web/src/app/(admin)/admin/page.tsx` and
  `apps/web/src/app/(admin)/admin/system/dead-letter.tsx` (render the true count
  and say the list is capped)
- `apps/workers/src/core/ops-health-check.ts` (the new check)
- One test file, in whichever of `apps/api/test/` or `apps/workers/test/` matches
  what you touched

**Out of scope** (do NOT touch):
- **Redriving the 602.** `redriveDeadLetter` already exists
  (`queue-admin.ts:240-247`) and is wired to a button. Replaying 602 pipeline jobs
  at once is a production action with real blast radius (re-scrapes, re-classifies,
  possibly re-sent alerts), and whether it is even wanted depends on step 1. This
  plan makes the depth visible; a human decides what to do about it.
- `packages/queue/src/jobs.ts`. The dead-letter routing and "no worker consumes it"
  are deliberate.
- The `failures24h` block and the rest of `/queue-health`.
- Any change to retry limits on the four pipeline jobs.

## Git workflow

- Branch: `advisor/025-dead-letter-depth`
- Conventional Commits, subject at most 50 chars, imperative. Suggested:
  `fix(admin): report the real dead-letter depth`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Establish whether 602 is residue or a leak

Before any code. Ask the operator to run this against the queue database
(`QUEUE_DATABASE_URL`, reachable only from the queue host):

```sql
SELECT created_on::date AS day, source_name, count(*)
FROM pgboss.job
WHERE name = 'outrival-dlq'
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;
```

Two shapes, two different follow-ups, and they are not this plan's job to execute:

- **Concentrated on 2026-07-21 and 2026-07-22** → residue of the AI provider
  incident of those dates (measured separately: 622 AI errors on 07-21, 170 on
  07-22, then 0 on 07-24 and 07-25). The 602 is a one-off to triage, and the value
  of this plan is that the next incident is visible while it happens.
- **Spread evenly across days** → a continuous leak, and `source_name` names which
  of the four pipeline jobs is shedding work. That is a separate plan.

Record the answer. Do **not** let it change the code you write: the fix is the same
either way, only the urgency of the follow-up differs.

If the operator cannot reach the queue host, note it and continue to step 2. Unlike
plan 019's step 4, this measurement informs the follow-up rather than the fix, so it
is not a STOP.

### Step 2: Count the dead-letter queue instead of measuring a page of it

In `apps/api/src/lib/queue-admin.ts`, add `countDeadLetter(): Promise<number | null>`
next to `listDeadLetter`, running `select count(*)::int from pgboss.job where name =
'outrival-dlq'`. Return `null` on failure, matching every other reader in that file.

In `apps/api/src/routes/admin/system.ts`, call it alongside `listDeadLetter` and
change the response block to:

```ts
    deadLetter: {
      available: deadLetterRows !== null,
      count: deadLetterCount ?? deadLetterRows?.length ?? 0,
      capped: (deadLetterRows?.length ?? 0) >= DLQ_CAP,
      rows: deadLetterRows ?? [],
    },
```

`capped` mirrors the `failures24h` block directly above, so the shape stays
consistent within one payload. Keep `DLQ_CAP` at 25: the list is a sample for
inspection and does not need to grow.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Make the UI stop implying the list is the whole queue

- `apps/web/src/lib/api.ts`: add `capped: boolean` to the `deadLetter` type
  (around line 1869). Add it next to the existing fields; do not reorganize the file.
- `apps/web/src/app/(admin)/admin/system/dead-letter.tsx`: when `capped` is true,
  render one line under the list saying the newest `DLQ_CAP` of `count` are shown.
  Match the section's existing copy style; no new component library.
- The overview tile in `apps/web/src/app/(admin)/admin/page.tsx` needs no change
  once the count is true, which is the point of step 2. Confirm you did not touch it
  beyond that.

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Alert on depth from ops-health-check

Add one check to `apps/workers/src/core/ops-health-check.ts`, in its own `try/catch`,
modeled on the first-signal SLO block at lines 122-139.

- Read the dead-letter depth from `packages/queue` (workers may import it;
  `apps/api` they may not). Look for an existing counter on `getBoss()` before
  writing raw SQL.
- Push an alert when the depth exceeds a threshold. Put the threshold in a named
  module constant with a comment justifying the number, not a bare literal. Pick it
  from step 1's data if you have it; if you do not, pick a value that would have
  fired well before 602 and say so in the comment.
- Always `logger.log` the depth, alert or not, so the trend is in the run output the
  way the first-signal SLI already is. That is what makes a future "when did this
  start" answerable without SSH.

**Verify**: `pnpm typecheck` → exit 0.

### Step 5: Test the thing that was wrong

The defect was a count derived from a capped list, so the test must be about that
and nothing else. In `apps/api/test/`, modelled on an existing route test:

- seed more dead-letter rows than `DLQ_CAP` (26 or more),
- assert `deadLetter.count` equals the seeded total, **not** `DLQ_CAP`,
- assert `deadLetter.rows.length` equals `DLQ_CAP`,
- assert `deadLetter.capped` is `true`,
- and with 1 row seeded, assert `capped` is `false` and `count` is 1.

If the API test harness cannot reach a pg-boss schema (it runs on PGlite against the
app schema, and `pgboss.job` lives in a different database), STOP and report rather
than mocking the queue client into meaninglessness. In that case the honest test
lives in `apps/workers/test/` against the threshold function from step 4 instead:
extract that comparison into a pure exported function and test its boundaries.

**Verify**: `pnpm test` → exit 0, with the new cases passing.

## Test plan

Covered in step 5. The one assertion that must exist, whichever file it lands in:
**a dead-letter queue deeper than `DLQ_CAP` reports its real depth.** That single
case is the regression this plan exists to prevent.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0, with the new cases passing
- [ ] `grep -n "count(\*)" apps/api/src/lib/queue-admin.ts` shows the new counter
- [ ] `grep -c "deadLetter\|dlq" apps/workers/src/core/ops-health-check.ts` is no
      longer 0
- [ ] The ops-health threshold is a named constant with a justifying comment
- [ ] `packages/queue/src/jobs.ts` is **unmodified**
- [ ] No redrive was executed
- [ ] `git status` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row for 025 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `listDeadLetter` or the `deadLetter` response block does not match the excerpts.
- The workers have no way to read queue depth without importing from `apps/api`.
  Crossing that boundary is forbidden by `.claude/rules/monorepo.md`; report it and
  let the plan be rewritten around a queue-side helper.
- Step 5's test cannot be written without mocking the queue client so heavily that
  it asserts nothing real. Take the pure-function route described there, or report.
- You are tempted to redrive the queue to "verify the fix". Do not. The fix is
  verified by a test with 26 seeded rows, not by moving 602 production jobs.

## Maintenance notes

- The bug class is worth naming in review: **a count derived from a capped list**.
  `failures24h` in the same payload dodged it only by exposing a `capped` flag. Any
  future panel that lists-and-counts should count separately.
- Once the depth is honest and alerting, the natural follow-up is whether the four
  pipeline jobs should dead-letter at all, or whether some deserve more retries
  first. That is a separate decision and needs the `source_name` breakdown from
  step 1.
- Redrive remains manual and capped at 100 per click (`queue-admin.ts:240`). At 602
  that is 7 clicks with no progress indicator. If redrive becomes routine rather
  than exceptional, that ergonomics gap is the next thing to fix, not before.
