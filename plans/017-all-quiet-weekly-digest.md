# Plan 017: Send an "all quiet" weekly digest instead of going silent on calm weeks (Lever 6)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result. If anything in "STOP conditions" occurs,
> stop and report. When done, update this plan's row in `plans/README.md` unless a
> reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 81c4b75..HEAD -- apps/workers/src/jobs/generate-weekly-digest.job.ts apps/workers/src/lib/digest-email.ts`
> If either changed, compare against "Current state" before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction (feature)
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

Outrival is a monitoring product, and the weekly digest **skips any org with no signals**
that week — so on a calm week the product goes silent and invisible from the inbox where
its retention actually lives, exactly when a quiet user is most likely to wonder whether it's
even running. This is "Void 2 (quiet periods)" in `docs/post-onboarding-activation.md`, whose
**Lever 6 ("All quiet" digest, validated)** specs the fix: instead of skipping, send a light
"We checked N pages, M times this week — no significant moves, your market was calm" briefing.
The digest HTML shell, Resend sending, unsubscribe tokens, and local-time send already exist.

Grounding: `docs/post-onboarding-activation.md:209-215` (Lever 6, "validated", "Trivial
effort, closes Void 2") and the skip at `generate-weekly-digest.job.ts:103-107`.

## Current state

- **The skip** — `apps/workers/src/jobs/generate-weekly-digest.job.ts:103-107`:
  ```ts
  if (weekSignals.length === 0) {
    logger.log("No signals for org this week, skipping", { orgId: org.id });
    skipped++;
    continue;
  }
  ```
- The job iterates `organizations` where `digestEnabled = true`, is **idempotent per
  (orgId, weekStart)** via an `existing` digest lookup, and for signal weeks: generates the
  AI digest, inserts a `digests` row (`period: "weekly"`), sends via `getResend().emails.send`
  with the subject `Your Monday Competitive Briefing — week of <date>`, then stamps
  `digests.sentAt` (lines 119-244). It builds email HTML via `renderDigestEmail(...)` from
  `../lib/digest-email` and supports one-click unsubscribe headers + signed feedback links.
- **Template reference for a light, standalone email**: the daily digest builds inline HTML
  directly (`apps/workers/src/jobs/generate-daily-digest.job.ts:178-198`) with the same
  `getResend()` / `ALERT_FROM` / unsubscribe-header pattern — a good model for a simple
  all-quiet body that does not depend on the full AI `digest` content shape.
- **Counts source**: `scrape_runs` (analytics table, `packages/db/src/schema/analytics.ts`)
  records each scrape (`competitor_id`, `recorded_at`, `status`); active monitors are
  relational (`monitors` joined to `competitors` by `orgId`). Analytics reads are best-effort.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0 |
| Workers tests | `pnpm --filter @outrival/workers test` | all pass, incl. new tests |
| Full suite | `pnpm test` | exit 0 |

## Scope

**In scope**:
- `apps/workers/src/jobs/generate-weekly-digest.job.ts` (replace the skip with an all-quiet path)
- `apps/workers/src/lib/digest-email.ts` (add `renderAllQuietDigest(...)`, or add a light
  variant — follow the existing renderer's structure)
- a test file for the counts helper / all-quiet decision (see Test plan)

**Out of scope**:
- The AI digest generation path for signal weeks — unchanged.
- The in-app "Last check: Xh ago — all quiet" feed empty-state mirror — a nice second brick,
  but defer it (note in Maintenance) to keep this plan bounded to the email.
- The daily digest job — reference only, don't modify.
- Notification-moderation/quiet-hours logic — the weekly digest is opt-in via `digestEnabled`;
  respect that flag (already the loop's filter). Do not wire in the dispatcher here.

## Git workflow

- Branch: `advisor/017-all-quiet-digest`
- Commit(s), conventional: `feat(digest): send an all-quiet weekly briefing on calm weeks`.
- Do NOT push unless instructed.

## Steps

### Step 0 (investigate first): decide how to stay idempotent

The signal-week path persists a `digests` row for (orgId, weekStart) and the digest reader
(`/dashboard/digests/[id]`) renders that row's `content` jsonb. Before writing code, decide
the least-coupled way to make the all-quiet send idempotent (so a job retry doesn't re-email):

- **Option A (preferred if simple)**: persist a minimal all-quiet `digests` row (`period:
  "weekly"`, a small `content` the reader tolerates — inspect the reader to confirm what
  shape it needs, or add an `allQuiet: true` marker the reader can render) and stamp `sentAt`.
  This reuses the existing `existing`-lookup idempotency for free.
- **Option B**: if the reader can't tolerate a light content shape without significant work,
  gate the send on a cheaper idempotency marker (e.g. skip if a `digests` row already exists
  for (orgId, weekStart) regardless of content) and persist a minimal row purely as the marker.

If neither is achievable without changing the reader in a non-trivial way, **STOP and report**
— do not ship a non-idempotent send (retry would double-email).

**Verify**: you can state, in one sentence, how a retry after a mid-loop crash will NOT
re-send the all-quiet email.

### Step 1: Add a counts helper

Add a best-effort helper (in the job file or a small lib) that returns, for an org over
`[weekStart, weekEnd)`:
- `pages`: count of active monitors for the org (relational — reliable). Join `monitors` to
  `competitors` by `orgId`, `isActive = true`, exclude internal/self as the rest of the app
  does. This is the "N pages" number.
- `checks`: best-effort count of `scrape_runs` rows for the org's competitors in the window
  (wrap in try/catch; if it fails or is 0, omit the "M times" clause rather than showing 0).

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Add the light email renderer

In `apps/workers/src/lib/digest-email.ts`, add `renderAllQuietDigest({ pages, checks,
weekStart, weekEnd, unsubscribeUrl })` returning HTML in the same visual language as the
existing digest email (reuse the shared header/footer helpers if the file exposes them;
otherwise mirror the daily digest's inline HTML). Copy must be English (repo rule): e.g.
*"We checked {pages} pages{checks ? `, ${checks} times` : ''} this week. No significant
moves — your market was calm."* Include the one-click unsubscribe footer when a URL is given.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Replace the skip with the all-quiet send

Replace the `continue` at `generate-weekly-digest.job.ts:103-107` with the all-quiet path:
- honor the idempotency decision from Step 0 (skip if already sent this week),
- compute counts (Step 1),
- if `org.digestEmail` is set, render (Step 2) and send via `getResend().emails.send` with a
  subject consistent with the briefing branding (e.g. `Your Monday Competitive Briefing —
  all quiet (week of <date>)`), including the same unsubscribe headers the signal path uses,
- persist the idempotency marker + `sentAt`, increment the `sent` counter (or a new
  `allQuietSent` counter for logging), and `continue`.

Keep the AI circuit-breaker check untouched — the all-quiet path makes **no AI call**, so it
should still run even if the breaker is open (consider: the breaker check is at the top of the
job; the all-quiet path doesn't need AI, but leave the top-level breaker behavior as-is unless
it would block all-quiet sends — if it does, note it; do not restructure the breaker here).

**Verify**: `pnpm typecheck` → exit 0. `pnpm --filter @outrival/workers test` → all pass.

### Step 4: Test the counts + all-quiet decision

Add a test (model after an existing `apps/workers/**/*.test.ts`, e.g. the digest/dispatcher
tests) for the pure parts: the counts helper (given seeded monitors/scrape_runs → correct
`pages`/`checks`, and `checks` omitted when unavailable) and the all-quiet copy (pages/checks
render into the expected string; `checks=0` omits the "times" clause). Keep it pure — do not
require a live Resend/AI.

**Verify**: `pnpm --filter @outrival/workers test` → all pass.

## Test plan

- New unit tests for the counts helper and the all-quiet copy rendering (Step 4). These are
  the regression guards: the count math and the "omit M when 0/unavailable" branch.
- Existing weekly-digest behavior for signal weeks must be unchanged (no test regressions).
- Verification: `pnpm --filter @outrival/workers test` and `pnpm typecheck` pass.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] The `weekSignals.length === 0` branch now sends an all-quiet email (for orgs with a
      `digestEmail`) instead of `continue`-only
- [ ] The all-quiet send is idempotent per (orgId, weekStart) — a retry does not re-email
- [ ] The all-quiet email makes **no AI call** and renders English copy with `pages`(/`checks`)
- [ ] New unit tests for counts + copy pass; `pnpm --filter @outrival/workers test` green
- [ ] Only in-scope files (+ test) changed (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- Making the all-quiet send idempotent requires non-trivial changes to the digest reader or
  the `digests` content schema (Step 0 Option A/B both fail cheaply) — report; do not ship a
  non-idempotent send.
- The top-level AI circuit-breaker `throw` would prevent all-quiet sends when providers are
  down — report (the all-quiet path shouldn't need AI, so it ideally still sends).
- `renderDigestEmail`'s helpers can't be reused and the light template would drift visually
  from the brand — report rather than inventing a divergent design.

## Maintenance notes

- **Deferred second brick**: the in-app "Last check: Xh ago — all quiet" feed empty-state
  mirror (also in Lever 6) — a small web-only follow-up.
- Reviewer should scrutinize idempotency (the double-email risk) and that signal weeks are
  completely unaffected.
- Once the pg-boss migration lands (separate effort), the scheduling/idempotency mechanics
  may move; keep the all-quiet decision logic pure so it ports cleanly.
