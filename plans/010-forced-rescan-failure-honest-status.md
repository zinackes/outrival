# Plan 010: A failed forced re-scan reports an honest "failed" status instead of hanging the poll to timeout

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result. If anything in "STOP conditions" occurs,
> stop and report. When done, update this plan's row in `plans/README.md` unless a
> reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 81c4b75..HEAD -- packages/db/src/schema/forced-rescan-log.ts apps/workers/src/jobs/scrape-monitor.job.ts apps/api/src/routes/monitors.ts apps/web/src/hooks/use-force-rescan.ts`
> If any changed, compare against "Current state" before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S–M (includes one small additive migration)
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

When a user forces a re-scan and it **fails all retries**, the outcome is never recorded:
`scrape-monitor`'s `onFailure` handler updates the monitor but never touches the
`forced_rescan_log` row. The API status endpoint reports `done: resultCapturedAt !== null`,
so the row stays "not done" forever, and the web hook polls for **150 seconds** before
giving up with a soft "it's taking a little longer than usual" toast — when the truth is
the re-scan failed. The user is misled on both the competitor page and My Product (same
hook). This plan records the failure and surfaces an honest message.

## Current state

- **Schema** — `packages/db/src/schema/forced-rescan-log.ts`:
  ```ts
  export const forcedRescanLog = pgTable("forced_rescan_log", {
    id: ..., userId: ..., orgId: ..., monitorId: ..., taskId: text("task_id"),
    triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
    resultCapturedAt: timestamp("result_captured_at"),   // null until the run finishes
    hadNewSignal: boolean("had_new_signal"),
  }, ...);
  ```
- **Success path stamps it** — `apps/workers/src/jobs/scrape-monitor.job.ts:1234-1239`:
  ```ts
  if (input.triggeredBy === "user_forced_rescan" && input.forcedRescanLogId) {
    await db.update(forcedRescanLog)
      .set({ resultCapturedAt: new Date(), hadNewSignal: changeId !== null })
      .where(eq(forcedRescanLog.id, input.forcedRescanLogId));
  }
  ```
- **Failure path does NOT** — `scrape-monitor.job.ts:1257-1317` `onFailure({ payload, error })`
  parses the payload (`InputSchema.safeParse(payload)` → `parsed.data`, which has
  `triggeredBy` and `forcedRescanLogId`), updates `monitors`, and logs `scrape_runs` — but
  never updates `forcedRescanLog`.
- **Status endpoint** — `apps/api/src/routes/monitors.ts:365-374`:
  ```ts
  return c.json({
    done: log.resultCapturedAt !== null,
    hadNewSignal: log.hadNewSignal,
    nextRunAt: monitor?.nextRunAt ?? null,
  });
  ```
- **Web hook** — `apps/web/src/hooks/use-force-rescan.ts:57-81` polls `forceRescanStatus`
  until `status.done` or `POLL_TIMEOUT_MS` (150_000). On timeout it shows the soft
  "taking a little longer" `toast.info`. There is no "failed" branch.
- Migrations are versioned (drizzle-kit). Latest is `packages/db/migrations/0029_*.sql`;
  `pnpm db:generate` creates the next sequential file + snapshot. The API test harness
  applies these migrations to a PGlite DB, and `packages/db/test/migrations.test.ts`
  checks journal/snapshot contiguity.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Generate migration | `pnpm db:generate` | new `NNNN_*.sql` + `meta/NNNN_snapshot.json` created |
| Typecheck | `pnpm typecheck` | exit 0 |
| DB migration test | `pnpm --filter @outrival/db test` | passes (contiguity + applies clean) |
| API tests | `pnpm --filter @outrival/api test` | all pass |
| Full suite | `pnpm test` | exit 0 |

## Scope

**In scope**:
- `packages/db/src/schema/forced-rescan-log.ts` (add a `failed` column)
- the generated `packages/db/migrations/NNNN_*.sql` + `meta/NNNN_snapshot.json` + journal
- `apps/workers/src/jobs/scrape-monitor.job.ts` (stamp the log in `onFailure`)
- `apps/api/src/routes/monitors.ts` (add `failed` to the status response)
- `apps/web/src/hooks/use-force-rescan.ts` (honest failed toast)
- a test file for the status endpoint (see Test plan)

**Out of scope**:
- **Applying** the migration to any shared environment (dev/staging/prod) — generation +
  commit only. The operator applies it (prod rules forbid the assistant migrating shared
  envs). The API/DB tests apply it to an ephemeral PGlite DB, which is fine.
- The success-path stamping (already correct) and the daily-limit counting logic.
- Any change to the retry/backoff or `markedUnscrapable` behavior in `onFailure`.

## Git workflow

- Branch: `advisor/010-forced-rescan-failure`
- Commit(s), conventional: `fix(rescan): record and surface forced re-scan failures`.
- Commit the generated migration + snapshot together with the schema change.
- Do NOT push or apply migrations to shared envs.

## Steps

### Step 1: Add a `failed` column to the schema

In `packages/db/src/schema/forced-rescan-log.ts`, add after `hadNewSignal`:
```ts
failed: boolean("failed"),  // null = pending/unknown, false = ran, true = all retries failed
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Generate the migration

Run `pnpm db:generate`. It should produce the next `NNNN_*.sql` adding the `failed`
column plus its `meta/NNNN_snapshot.json` and update `meta/_journal.json`.

**Verify**:
- `pnpm --filter @outrival/db test` → passes (contiguity + clean apply on PGlite).
- The generated SQL is a single `ALTER TABLE "forced_rescan_log" ADD COLUMN "failed" boolean;`
  (or equivalent) — no unrelated changes. If the diff includes anything else, STOP.

### Step 3: Stamp the log on failure

In `scrape-monitor.job.ts` `onFailure`, after `parsed` succeeds, add (using `parsed.data`):
```ts
if (parsed.data.triggeredBy === "user_forced_rescan" && parsed.data.forcedRescanLogId) {
  await db.update(forcedRescanLog)
    .set({ resultCapturedAt: new Date(), hadNewSignal: false, failed: true })
    .where(eq(forcedRescanLog.id, parsed.data.forcedRescanLogId));
}
```
Place it alongside the existing monitor/scrape_run writes in `onFailure` (order doesn't
matter; keep it best-effort consistent with the surrounding writes). Ensure
`forcedRescanLog` is imported in the job (it already is, for the success path).

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Surface `failed` in the status endpoint

In `apps/api/src/routes/monitors.ts` status handler, add `failed` to the response:
```ts
return c.json({
  done: log.resultCapturedAt !== null,
  failed: log.failed ?? false,
  hadNewSignal: log.hadNewSignal,
  nextRunAt: monitor?.nextRunAt ?? null,
});
```
Update the `api.forceRescanStatus` return type in `apps/web/src/lib/api.ts` to include
`failed: boolean` (find the existing `forceRescanStatus` type and add the field).

**Verify**: `pnpm typecheck` → exit 0.

### Step 5: Honest failed toast in the hook

In `apps/web/src/hooks/use-force-rescan.ts`, when a polled `status.done` is true, branch
on `status.failed` before the had-new-signal branch:
```ts
if (status?.done) {
  outcome = { hadNewSignal: status.hadNewSignal, nextRunAt: status.nextRunAt, failed: status.failed };
  break;
}
...
if (outcome?.failed) {
  toast.error("Re-scan failed — we couldn't reach the source. It'll retry automatically.", { id: toastId });
} else if (outcome?.hadNewSignal) {
  toast.success("Re-scan complete — we found an update. It's in your latest signals.", { id: toastId });
} else if (outcome) {
  toast.info(`Re-scan complete — nothing new. Next automatic check around ${formatDay(outcome.nextRunAt)}.`, { id: toastId });
} else {
  // unchanged 150s-timeout branch
}
```
Extend the local `outcome` type to include `failed?: boolean`. Keep the existing 429 and
"no rescanLogId" branches unchanged.

**Verify**: `pnpm typecheck` → exit 0.

### Step 6: Test the status endpoint's failed path

Add (or extend an existing) `apps/api/src/routes/monitors.test.ts` case: seed a
`forced_rescan_log` row with `failed: true, resultCapturedAt: <now>`, call the status
endpoint, assert the response has `done: true, failed: true`. Also assert a row with
`failed: false` (or null) returns `failed: false`. Model after an existing
`apps/api/src/routes/*.test.ts`.

**Verify**: `pnpm --filter @outrival/api test` → all pass.

## Test plan

- New/extended `monitors.test.ts` case for `failed: true` and `failed: false` status
  responses (Step 6) — the API-level regression guard.
- `packages/db` migration test proves the schema change applies cleanly.
- Verification: `pnpm --filter @outrival/api test` and `pnpm --filter @outrival/db test`
  pass; `pnpm typecheck` exits 0.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm --filter @outrival/db test` passes (new migration is contiguous + applies)
- [ ] `pnpm --filter @outrival/api test` passes, incl. the failed-status case
- [ ] `onFailure` stamps `forced_rescan_log` (`failed: true`) for user-forced re-scans
- [ ] Status endpoint returns `failed`; hook shows a `toast.error` on failure
- [ ] Generated migration touches only the `failed` column; nothing else in the diff
- [ ] Only in-scope files (+ the generated migration/snapshot/journal) changed (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- `pnpm db:generate` produces a migration containing changes **beyond** adding `failed`
  (schema drift from an unrelated pending change) — report the diff; do not commit it.
- The generated migration number collides with an existing file (a partially-applied
  earlier migration) — report; do not hand-edit the journal.
- `InputSchema` in `scrape-monitor.job.ts` does not actually carry `triggeredBy` /
  `forcedRescanLogId` as the success path implies (drift) — report.
- The API test harness does not apply migrations from `packages/db/migrations` (so the
  new column isn't present in tests) — report; do not work around it with a manual DDL.

## Maintenance notes

- The operator must apply the migration to dev/staging/prod (versioned flow:
  `pnpm db:migrate`), per the production migration rules — this plan only generates it.
- Reviewer should confirm the `onFailure` stamp is guarded to user-forced runs only (a
  scheduled scrape has no `forcedRescanLogId`, so the guard must not fire for it).
- If a future change adds more forced-rescan outcome states, prefer a `status` enum over
  more booleans.
