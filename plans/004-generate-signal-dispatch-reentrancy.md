# Plan 004: Make `generate-signal` re-dispatch a signal that was committed but never dispatched

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 81c4b75..HEAD -- apps/workers/src/jobs/generate-signal.job.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

`generate-signal` inserts the `signals` row (its idempotency checkpoint) and only **after** that
commit does it decide dispatch, stamp `dispatchedChannel`, and trigger `send-alert`. If a
retry-triggering throw lands in that post-commit window (a transient Neon error inside
`decideDispatch` or the `dispatchedChannel` update — exactly what `retry.maxAttempts:3` is for), the
job throws, and on retry the early-return short-circuits because a signal already exists. The signal
is left permanently with `dispatchedChannel = null` and **`send-alert` is never triggered** — a
paying realtime-alerts customer silently never gets paged for a critical competitor move. The fix
makes the retry re-enter the dispatch path idempotently instead of skipping it.

Dispatch is safe to re-run: `decideDispatch` is a pure decision function (reads org prefs + a signal
count, returns a decision object — no inserts/increments of its own), and the `send-alert` trigger
already uses `idempotencyKey: newSignal.id`, so re-triggering is a no-op.

## Current state

`apps/workers/src/jobs/generate-signal.job.ts`:

**Early-return (idempotency checkpoint), ~lines 69–75:**
```ts
const existing = await db.query.signals.findFirst({ where: eq(signals.changeId, input.changeId) });
if (existing) {
  logger.log("Signal already exists, skipping", { signalId: existing.id });
  return { skipped: true, signalId: existing.id };   // ← skips dispatch even if it never ran
}
```

**`isBackfill` derivation, ~lines 88–95** (needed by the re-dispatch path):
```ts
let isBackfill = false;
if (change.snapshotBeforeId) {
  const before = await db.query.snapshots.findFirst({
    where: eq(snapshots.id, change.snapshotBeforeId), columns: { origin: true },
  });
  isBackfill = before?.origin === "archive";
}
```

**Signal insert (checkpoint), ~lines 211–241** — `onConflictDoNothing({ target: signals.changeId })`,
and a concurrent-race guard: `if (!newSignal) return { skipped: true };`. Leave this as-is.

**Dispatch tail, ~lines 290–332** (this is the block that runs after the commit and can throw):
```ts
const decision = isBackfill
  ? ({ send: false, channel: "in_app_only", filteredReason: "backfill" } as const)
  : await decideDispatch(competitor.orgId, {
      signalId: newSignal.id,
      severity,
      relevanceScore: newSignal.relevanceScore,
      competitorId: competitor.id,
      category,
    });
await db.update(signals).set({
  dispatchedChannel: decision.channel,
  filteredReason: decision.filteredReason ?? null,
  filteredAt: decision.filteredReason ? new Date() : null,
}).where(eq(signals.id, newSignal.id));

if (decision.send && decision.channel === "email_immediate" && !competitor.alertsMuted) {
  if (org?.alertsEnabled && PLAN_LIMITS[org.plan].features.realtimeAlerts) {
    await tasks.trigger("send-alert", { signalId: newSignal.id }, { idempotencyKey: newSignal.id });
    logger.log("Alert triggered", { signalId: newSignal.id });
  }
} else {
  logger.log("Signal deferred by moderation", { signalId: newSignal.id, channel: decision.channel, reason: decision.filteredReason ?? null });
}
```

The variables it needs: `isBackfill`, `competitor` (`.id`, `.orgId`, `.alertsMuted`), `org`
(`.alertsEnabled`, `.plan`), `severity`, `category`, and the signal's `id` + `relevanceScore`.

`signals.dispatchedChannel` is nullable and starts null at insert; the update above is the only place
it becomes non-null. So **`dispatchedChannel !== null` is a reliable "was dispatched" marker.**

## Commands you will need

| Purpose            | Command                                              | Expected on success  |
|--------------------|------------------------------------------------------|----------------------|
| Typecheck workers  | `pnpm --filter @outrival/workers typecheck`          | exit 0, no errors    |
| Workers unit tests | `pnpm --filter @outrival/workers test`               | all pass (unchanged) |

(No `pnpm install` needed. Do NOT run `next build` / full `pnpm build`.)

## Scope

**In scope**:
- `apps/workers/src/jobs/generate-signal.job.ts`

**Out of scope** (do NOT touch):
- `apps/workers/src/lib/notification-dispatcher.ts` (`decideDispatch`) — reuse as-is.
- `apps/workers/src/jobs/send-alert.job.ts` — already idempotency-keyed.
- The signal insert, the `onConflictDoNothing` concurrent-race guard, the AI insight generation, the
  `insertAiQualityCheck` / `insertSignalFeed` / first-signal / celebration best-effort blocks.
- The DB schema. Do NOT add a migration; `dispatchedChannel` nullability already gives the marker.

## Git workflow

- Branch: `advisor/004-generate-signal-redispatch`
- One commit; conventional-commit style (e.g. `fix(workers): re-dispatch undispatched signals on retry`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract the dispatch tail into a reusable helper

At module scope in `generate-signal.job.ts` (near the other top-level helpers), add a function that
contains **exactly** the current dispatch-tail logic, parameterized by what it reads. Preserve every
condition and value — move, don't rewrite. Use the same types the surrounding code uses (infer them
from the existing `competitor`, `org`, `severity`, `category`, `newSignal` values; if you need a type
name, reuse whatever the current inline code relies on — do not introduce `any`).

```ts
async function dispatchSignal(args: {
  signalId: string;
  severity: typeof signals.$inferSelect.severity;   // or the existing SignalSeverity type in scope
  category: typeof signals.$inferSelect.category;    // or the existing SignalCategory type in scope
  relevanceScore: number | null;
  competitor: { id: string; orgId: string; alertsMuted: boolean | null };
  org: { alertsEnabled: boolean | null; plan: keyof typeof PLAN_LIMITS } | null | undefined;
  isBackfill: boolean;
}): Promise<void> {
  const { signalId, severity, category, relevanceScore, competitor, org, isBackfill } = args;
  const decision = isBackfill
    ? ({ send: false, channel: "in_app_only", filteredReason: "backfill" } as const)
    : await decideDispatch(competitor.orgId, {
        signalId, severity, relevanceScore, competitorId: competitor.id, category,
      });
  await db.update(signals).set({
    dispatchedChannel: decision.channel,
    filteredReason: decision.filteredReason ?? null,
    filteredAt: decision.filteredReason ? new Date() : null,
  }).where(eq(signals.id, signalId));

  if (decision.send && decision.channel === "email_immediate" && !competitor.alertsMuted) {
    if (org?.alertsEnabled && PLAN_LIMITS[org.plan].features.realtimeAlerts) {
      await tasks.trigger("send-alert", { signalId }, { idempotencyKey: signalId });
      logger.log("Alert triggered", { signalId });
    }
  } else {
    logger.log("Signal deferred by moderation", { signalId, channel: decision.channel, reason: decision.filteredReason ?? null });
  }
}
```

If the exact `severity` / `category` type names used inline differ, use those instead of the
`$inferSelect` forms above — the goal is byte-for-byte the same runtime behavior with correct types.

**Verify**: `pnpm --filter @outrival/workers typecheck` → exit 0 (with the helper defined but not yet used it should still compile; if unused-var lint fails, proceed to Step 2 which uses it).

### Step 2: Replace the inline dispatch tail with a call to the helper

In the main `run()` body, replace the inline dispatch block (~lines 290–332, the `const decision = …`
through the `if (decision.send …) { … } else { … }`) with a single call:

```ts
await dispatchSignal({
  signalId: newSignal.id,
  severity,
  category,
  relevanceScore: newSignal.relevanceScore,
  competitor,
  org,
  isBackfill,
});
```

This must be behavior-preserving for the normal path — the same values flow in.

**Verify**: `pnpm --filter @outrival/workers typecheck` → exit 0.

### Step 3: Re-dispatch on retry instead of skipping an undispatched signal

Change the early-return (~lines 69–75) so it only short-circuits when the existing signal was already
dispatched; otherwise it re-runs dispatch for that existing signal and returns:

```ts
const existing = await db.query.signals.findFirst({ where: eq(signals.changeId, input.changeId) });
if (existing) {
  if (existing.dispatchedChannel !== null) {
    logger.log("Signal already dispatched, skipping", { signalId: existing.id });
    return { skipped: true, signalId: existing.id };
  }
  // Signal was committed but a post-commit throw (transient DB error in the dispatch
  // window) left it never dispatched; a plain retry would skip it forever. Re-dispatch
  // idempotently: decideDispatch is pure and send-alert is idempotency-keyed.
  logger.log("Signal exists but was never dispatched — re-dispatching", { signalId: existing.id });

  const change = await db.query.changes.findFirst({ where: eq(changes.id, input.changeId) });
  if (!change) throw new AbortTaskRunError(`Change ${input.changeId} not found`);

  let isBackfill = false;
  if (change.snapshotBeforeId) {
    const before = await db.query.snapshots.findFirst({
      where: eq(snapshots.id, change.snapshotBeforeId), columns: { origin: true },
    });
    isBackfill = before?.origin === "archive";
  }
  const competitor = await db.query.competitors.findFirst({ where: eq(competitors.id, existing.competitorId) });
  if (!competitor) throw new AbortTaskRunError(`Competitor ${existing.competitorId} not found`);
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, competitor.orgId) });

  await dispatchSignal({
    signalId: existing.id,
    severity: existing.severity,
    category: existing.category,
    relevanceScore: existing.relevanceScore,
    competitor,
    org,
    isBackfill,
  });
  return { redispatched: true, signalId: existing.id };
}
```

Reuse the exact query patterns already in the file (the `isBackfill` derivation and the
`competitor` / `org` loads are copied from ~lines 88–111). `existing.severity` / `existing.category`
/ `existing.relevanceScore` / `existing.competitorId` come straight off the `signals` row.

**Verify**: `pnpm --filter @outrival/workers typecheck` → exit 0.

### Step 4: Full worker check

**Verify**: `pnpm --filter @outrival/workers typecheck` → exit 0, and
`pnpm --filter @outrival/workers test` → all existing tests pass.

## Test plan

- **No new automated test.** `generate-signal` runs against the real Postgres and `apps/workers` has
  no job-level DB harness (only pure-lib unit tests). A faithful retry test would need that harness —
  out of proportion here. Do NOT add a brittle mock-heavy job test.
- Correctness rests on: (a) `dispatchedChannel !== null` is a sound "dispatched" marker (it is only
  ever set by the dispatch update); (b) `decideDispatch` is side-effect-free (verified: it only reads);
  (c) `send-alert` is idempotency-keyed. A reviewer verifies by reading the diff.
- If a worker job-level DB harness later lands, add: insert a signal with `dispatchedChannel=null`, run
  `generate-signal` for its `changeId`, assert dispatch ran (channel stamped) and (for an
  email_immediate + realtime plan) `send-alert` was triggered once. Recorded as a follow-up below.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm --filter @outrival/workers typecheck` exits 0.
- [ ] `pnpm --filter @outrival/workers test` exits 0 (existing tests unchanged and green).
- [ ] `grep -n "dispatchedChannel !== null" apps/workers/src/jobs/generate-signal.job.ts` shows the
      guarded early-return.
- [ ] `grep -n "async function dispatchSignal" apps/workers/src/jobs/generate-signal.job.ts` shows the
      extracted helper, and it is called in both the main path and the re-dispatch path
      (`grep -c "dispatchSignal(" …` returns 3: the definition + 2 call sites, or 2 if you count only calls).
- [ ] `git status --porcelain` shows only `apps/workers/src/jobs/generate-signal.job.ts` modified.
- [ ] `plans/README.md` status row for 004 updated.

## STOP conditions

Stop and report back (do not improvise) if:

- The early-return, insert, `isBackfill` derivation, or dispatch tail does not match the "Current
  state" excerpts (drift).
- Extracting the helper forces a type you cannot express without `any` (report the exact type of
  `severity`/`category` in scope so the plan can be corrected) — do not reach for `any` or `@ts-ignore`.
- `decideDispatch` turns out to perform a write/increment (it should not) — if it does, re-dispatch is
  not safe and the design must change; stop and report.
- The concurrent-race guard `if (!newSignal) return { skipped: true };` (~line 238) would leave a
  loser run without dispatch AND you believe the winner won't dispatch — it will, and its own retry
  re-dispatches via Step 3; do not alter that guard.

## Maintenance notes

- The two `return` shapes now are `{ skipped }` (already dispatched or concurrent loser) and
  `{ redispatched }` (recovered an undispatched signal). Any caller/metrics reading the job result
  should treat both as success.
- Follow-up (deferred): a worker job-level DB harness enables a real retry-recovery test (see Test plan).
- A reviewer should scrutinize that `dispatchSignal` is byte-for-byte behavior-equivalent to the old
  inline tail (same conditions, same `send-alert` gate, same logs), and that the re-dispatch path
  loads `competitor`/`org`/`isBackfill` the same way the main path does.
