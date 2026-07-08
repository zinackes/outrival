# Plan 002: Stop `extract-*` jobs from duplicating rows when the AI summary step throws on retry

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 81c4b75..HEAD -- apps/workers/src/jobs/extract-reviews.job.ts apps/workers/src/jobs/extract-pricing.job.ts apps/workers/src/jobs/extract-jobs.job.ts`
> If any in-scope file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

`extract-reviews`, `extract-pricing`, and `extract-jobs` write their rows (verbatim reviews,
`pricing_history` / `review_scores` / `job_counts` time-series points) **before** calling the AI
`summarizeSource` step. That AI call goes through `loggedAi`, which **rethrows** on error (a Groq/AI
429 or timeout after the SDK's own retries — precisely the failure `retry.maxAttempts:3` exists to
handle). When it throws, Trigger.dev re-runs the whole job from the top, and because none of these
jobs has a per-snapshot idempotency guard, the inserts run **again** — duplicating user-visible
review verbatims and polluting pricing/score/job trend charts with duplicate data points on every
AI-summary failure. The fix reorders each job so the frequent, retry-triggering AI call happens
**before** the non-idempotent inserts, so a retry can't leave committed rows behind.

## Current state

`loggedAi` rethrows (this is the pivot that makes an AI failure retry the whole job):

- `apps/workers/src/lib/analytics.ts` (~lines 187–203):
  ```ts
  // ... "a throw (e.g. a 429 after the SDK's own retries) → error, rethrown so Trigger.dev still retries the job."
  export async function loggedAi<T>(task, config, fn): Promise<T> {
    try { const res = await fn(); await logAiRun(..., res == null ? "parse_failed" : "success"); return res; }
    catch (err) { await logAiRun(..., "error"); throw err; }   // ← rethrows
  }
  ```
- The `insert*` analytics helpers (`insertReviewScore`, `insertPricingHistory`, `insertJobCounts`) are
  **best-effort**: they swallow their own errors (never throw), but they DO append a row on success, so
  they are non-idempotent across retries. The relational `db.insert(reviews)` / `db.insert(jobPostings)`
  DO throw. None of the three jobs guards against re-running after a partial completion.

**`extract-reviews.job.ts`** — current order (~lines 124–169):
1. `db.insert(reviews)` (verbatims)                           ← relational, non-idempotent
2. `getPreviousReviewScore(...)` (read)
3. `insertReviewScore(...)` (best-effort, non-idempotent)
4. `loggedAi("source_summary", …, () => summarizeSource({ kind: "reviews", … }))`  ← THROWS
5. `if (summary) db.update(monitors).set({ aiSummary … })`

**`extract-pricing.job.ts`** — current order (~lines 91–146):
1. `getPreviousPricing(...)` (read)
2. `detectTrial` / `detectFreePlan` (pure)
3. `insertPricingHistory([...])` (best-effort, non-idempotent)
4. `if (!input.recordedAt)` → `loggedAi("source_summary", …, () => summarizeSource({ kind: "pricing", … }))`  ← THROWS
5. `if (summary) db.update(monitors).set({ aiSummary … })`

**`extract-jobs.job.ts`** — current order (~lines 120–205): `computeJobsDelta` yields `{ inserts, closedIds }`
BEFORE any write, then:
1. `db.insert(jobPostings)` (inserts)                         ← relational, non-idempotent
2. `db.update(jobPostings).set({ isActive:false, closedAt })` (close; guarded `isNull(closedAt)`)
3. `insertJobCounts([...])` (best-effort, non-idempotent)
4. `if (jobs.length>0 || closedIds.length>0)` → `loggedAi("source_summary", …, () => summarizeSource({ kind: "jobs", … }))`  ← THROWS
5. `if (summary) db.update(monitors).set({ aiSummary … })`

All the data `summarizeSource` needs is already computed before the inserts in every job (for jobs:
`inserts`, `closedIds`/`closedTitles`, `countsByDept` all derive from the delta + `existing`, which
are available before the writes). So the AI call is freely movable earlier.

## Commands you will need

| Purpose            | Command                                              | Expected on success  |
|--------------------|------------------------------------------------------|----------------------|
| Typecheck workers  | `pnpm --filter @outrival/workers typecheck`          | exit 0, no errors    |
| Workers unit tests | `pnpm --filter @outrival/workers test`               | all pass (unchanged) |

(No `pnpm install` needed. Do NOT run `next build` / full `pnpm build`.)

## Scope

**In scope**:
- `apps/workers/src/jobs/extract-reviews.job.ts`
- `apps/workers/src/jobs/extract-pricing.job.ts`
- `apps/workers/src/jobs/extract-jobs.job.ts`

**Out of scope** (do NOT touch):
- `apps/workers/src/lib/analytics.ts` and its `insert*` helpers. Do NOT try to thread a DB
  transaction through them — they use their own `db` handle and refactoring them is a separate,
  larger change.
- The **close-postings logic** in `extract-jobs.job.ts` (`computeJobsDelta`, the
  `db.update(jobPostings … isActive:false)` mutation, `jobs-delta.ts`). A separate finding covers
  hardening it against partial ATS results; do not alter its behavior here — only move the AI
  summary call relative to it.
- `packages/ai` (`summarizeSource` itself).

## Git workflow

- Branch: `advisor/002-extract-idempotency-reorder`
- One commit; conventional-commit style (e.g. `fix(workers): …`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

The invariant for each file: **every throwing operation that runs before the last non-idempotent
insert must be moved above all inserts.** Concretely — move the `summarizeSource` `loggedAi` call
AND the `monitors.aiSummary` update it feeds to run *before* the row inserts. The non-idempotent
inserts become the tail of the happy path, so a throw earlier means nothing was committed and the
retry re-runs cleanly.

### Step 1: Reorder `extract-reviews.job.ts`

Target order (compute `verbatims` as today, then):
1. `const previousScore = await getPreviousReviewScore(...)`  (read — move up if not already)
2. `const summary = await loggedAi("source_summary", …, () => summarizeSource({ kind:"reviews", …, previousScore, … }))`  ← moved above the inserts
3. `if (summary) await db.update(monitors).set({ aiSummary: summary.summary, aiSummaryUpdatedAt: new Date() }).where(eq(monitors.id, snapshot.monitorId))`  ← moved above the inserts
4. `if (verbatims.length > 0) await db.insert(reviews).values(verbatims)`
5. `if (extracted.average_score != null) await insertReviewScore({ … })`

Keep every argument to `summarizeSource` and the `structured`/`extracted` merge exactly as they are;
only the statement order changes. Add a one-line comment above the moved AI block explaining why it
runs first (retry-safety: the AI failure must not leave committed rows).

**Verify**: `pnpm --filter @outrival/workers typecheck` → exit 0.

### Step 2: Reorder `extract-pricing.job.ts`

Target order (after `previous`, `trial`, `freePlan`, `recordedAt` are computed):
1. `if (!input.recordedAt) { const summary = await loggedAi("source_summary", …, () => summarizeSource({ kind:"pricing", current: extracted.plans, previous })); if (summary) await db.update(monitors).set({ aiSummary … }).where(eq(monitors.id, snapshot.monitorId)); }`  ← moved above the insert
2. `await insertPricingHistory(extracted.plans.map(p => ({ … })))`  ← now the tail

Preserve the `if (!input.recordedAt)` guard around the summary (backfill runs must still skip the
summary) and the full `insertPricingHistory` row mapping unchanged.

**Verify**: `pnpm --filter @outrival/workers typecheck` → exit 0.

### Step 3: Reorder `extract-jobs.job.ts`

Compute `countsByDept` and `closedTitles` right after `computeJobsDelta` returns `{ inserts, closedIds }`
(they only depend on `jobs`, `existing`, `closedIds` — all available then). Then target order:
1. `if (jobs.length > 0 || closedIds.length > 0) { const summary = await loggedAi("source_summary", …, () => summarizeSource({ kind:"jobs", departments, total: jobs.length, added: inserts.map(j=>j.title), closed: closedTitles, previousTotal })); if (summary) await db.update(monitors).set({ aiSummary … }).where(eq(monitors.id, snapshot.monitorId)); }`  ← moved above the writes
2. `if (inserts.length > 0) await db.insert(jobPostings).values(inserts.map(...))`
3. `if (closedIds.length > 0) await db.update(jobPostings).set({ isActive:false, closedAt: now }).where(and(inArray(...), isNull(jobPostings.closedAt)))`  ← unchanged behavior
4. `await insertJobCounts([...])`

Do not change the close condition, the delta computation, or the `authoritative`/`skip` logic — only
move the summary block above the writes and compute `countsByDept`/`closedTitles` earlier.

**Note (accepted residual)**: after this change, `extract-jobs` still has a narrow window between the
`jobPostings` insert (2) and the close (3) — both relational, both can throw — where a rare transient
DB error could duplicate an insert on retry. That is pre-existing and belongs to the separate
close-hardening finding; do NOT try to fix it here (it would require touching the out-of-scope close
logic). This plan's goal is closing the frequent AI-summary-failure duplication, which Step 3 does.

**Verify**: `pnpm --filter @outrival/workers typecheck` → exit 0.

### Step 4: Full worker check

**Verify**: `pnpm --filter @outrival/workers typecheck` → exit 0, and
`pnpm --filter @outrival/workers test` → all existing tests pass (this change adds no tests; see Test plan).

## Test plan

- **No new automated test.** These jobs run against the real Postgres + R2 + AI provider and the
  `apps/workers` test suite has **no job-level DB harness** (only pure-lib unit tests:
  `ai-visibility-diff`, `jobs-delta`, `notification-dispatcher`, `rearm`). A faithful retry-duplication
  test would require building that harness — out of proportion to this reorder. Do **not** invent a
  brittle mock-heavy job test.
- Correctness is established by the ordering invariant (every throwing op precedes the non-idempotent
  inserts) plus typecheck. A reviewer verifies by reading the diff against the "Current state" orders.
- If the team later adds a worker job-level DB harness, the follow-up test is: mock `summarizeSource`
  to throw, run `extract-reviews`/`extract-pricing` once, assert zero rows were written (the inserts
  are now gated behind the AI call) — recorded as a maintenance follow-up below.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm --filter @outrival/workers typecheck` exits 0.
- [ ] `pnpm --filter @outrival/workers test` exits 0 (existing tests unchanged and green).
- [ ] In each of the three files, the `summarizeSource` `loggedAi(...)` call textually precedes the
      job's row insert(s). Verify by eye against the diff, or:
      `grep -n "summarizeSource\|db.insert\|insertReviewScore\|insertPricingHistory\|insertJobCounts\|db.update(jobPostings)" apps/workers/src/jobs/extract-reviews.job.ts apps/workers/src/jobs/extract-pricing.job.ts apps/workers/src/jobs/extract-jobs.job.ts`
      and confirm each file's `summarizeSource` line number is below (earlier than) its insert lines.
- [ ] `git status --porcelain` shows only the three in-scope files modified.
- [ ] `plans/README.md` status row for 002 updated.

## STOP conditions

Stop and report back (do not improvise) if:

- Any file's current statement order does not match its "Current state" excerpt (drift).
- `summarizeSource`'s arguments reference a value that is only computed *after* the inserts (so the
  AI call cannot be moved up without also moving that computation) — report what the dependency is.
- Typecheck fails for a reason other than an obvious ordering/scope typo in your edit.
- You find yourself needing to change `analytics.ts`, `jobs-delta.ts`, or the close mutation to make
  it compile — that means the reorder crossed into out-of-scope territory.

## Maintenance notes

- Follow-up (deferred): a worker job-level DB harness would let us assert the retry-safety directly
  (mock `summarizeSource` → throw → expect zero rows). Worth doing when the first such harness lands.
- Follow-up (deferred, separate finding): harden `extract-jobs` close against partial/truncated ATS
  results and wrap its insert+close in one atomic unit — that closes the residual noted in Step 3.
- A reviewer should confirm no behavior changed other than statement order (same rows written, same
  `monitors.aiSummary` value, same backfill `if (!input.recordedAt)` skip).
