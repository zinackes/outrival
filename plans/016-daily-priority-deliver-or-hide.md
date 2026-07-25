# Plan 016: `daily_priority` either does something, or stops being sold

> **Executor instructions**: This is a **decision plan**. Step 1 produces a
> recommendation; steps 3A and 3B are alternative implementations and you must do
> exactly one of them, chosen by the operator. Do not implement both, and do not
> pick for the operator if step 1 leaves it genuinely balanced: report and stop.
> Run every verification command listed. When done, update the status row for
> this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- packages/shared/src/constants/plans.ts apps/web/src/components/landing/pricing.tsx packages/queue/src/jobs.ts`
> If any changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P2
- **Effort**: S (hide) or M (deliver)
- **Risk**: LOW (hide) or MED (deliver: it changes free-tier scrape latency)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

The public pricing page sells "Priority monitoring cadence" as a headline
differentiator of the most expensive plan. The code says, in a comment, that the
feature does not exist.

That is a revenue-integrity problem, and this codebase has already ruled on this
exact class of issue once: `docs/paid-feature-delivery.md` covers two other
advertised-but-absent capabilities (`api` and `multiUser`) and records the
decision to flip both to `false` rather than let a tier advertise a capability
that returns nothing. `daily_priority` is the third instance and was not in that
review's scope. Unlike the other two, it is on the **public pricing page**, not
just an internal entitlements grid.

There is also a reason to revisit the original deferral rather than simply
hiding the claim. When `daily_priority` was labelled "future", job execution ran
on Trigger.dev, which offered no per-job queue priority. That constraint is gone:
pg-boss is now the production runtime and exposes priority natively through the
`SendOptions` that `enqueue` already passes straight through. So "deliver" is now
genuinely cheap, where before it was blocked.

## Current state

### The code says it does nothing (`packages/shared/src/constants/plans.ts:17-21`)

```ts
// Per-tier scrape cadence (decided 2026-06-04, "Repenser limites par tier").
// `weekly`/`daily` map onto the real reschedule; `daily_adaptive` is the existing
// staleness multiplier (computeNextRun), `daily_priority` is a future queue-priority
// label (no distinct runtime behaviour yet — see docs/tier-limits.md).
export const SCRAPE_FREQUENCY_TIERS = ["weekly", "daily", "daily_adaptive", "daily_priority"] as const;
```

`packages/shared/src/constants/plans.ts:128` assigns
`scrapeFrequency: "daily_priority"` to the business tier.

`docs/tier-limits.md:77-78` says the same thing independently.

### It is sold publicly (`apps/web/src/components/landing/pricing.tsx:79, 87`)

```tsx
    desc: "50 competitors, the highest usage limits, and priority support.",
```

```tsx
      "Priority monitoring cadence",
```

### And shown to paying customers (`apps/web/src/components/outrival/usage-dashboard.tsx:35`)

```ts
  daily_priority: "Daily (priority)",
```

Rendered in the plan-entitlements panel.

### The constraint that justified the deferral is gone

`packages/queue/src/jobs.ts:183` records that the pg-boss cutover removed the
10-cron cap that shaped several earlier workarounds. `packages/queue/src/boss.ts:163`
shows `enqueue: (data, options?: SendOptions)` passing pg-boss options straight
through, and pg-boss's `SendOptions` includes `priority`.

Two adjacent workarounds still cite the retired constraint and would also become
unnecessary: `packages/queue/src/jobs.ts:146` and `docs/architecture.md:1265`
piggyback the monthly recap onto `generate-daily-digest` explicitly to avoid
adding a cron.

### The precedent to follow

`docs/paid-feature-delivery.md` frames it as: "Selling a capability that returns
nothing is a revenue-integrity problem", and records HIDE as the reversible
default when delivery is not cheap.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Shared tests | `cd packages/shared && bun test src` | all pass |
| Queue tests | `cd packages/queue && bun test src` | all pass (after plan 002) |
| Workers tests | `cd apps/workers && bun test test/` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Whole suite | `pnpm test` | exit 0 |

Note: `turbo` is **not** on `PATH`. Use the `pnpm` scripts. Do not run
`pnpm build` locally (it exhausts this box's RAM).

## Scope

**In scope, option HIDE**:
- `apps/web/src/components/landing/pricing.tsx` (the feature string)
- `apps/web/src/components/outrival/usage-dashboard.tsx` (the entitlement label)
- `packages/shared/src/constants/plans.ts` (comment, and possibly the tier value)
- `docs/tier-limits.md`

**In scope, option DELIVER**:
- `packages/shared/src/constants/plans.ts` (a `priorityForPlan` helper next to
  the existing `clampFrequencyToPlan`)
- `apps/workers/src/core/schedule-scraping.ts` (pass `priority` on enqueue)
- `packages/queue/src/jobs.ts` (only if the `scrapeMonitor` enqueue signature
  needs widening)
- tests for the helper
- `docs/tier-limits.md`

**Out of scope in both options** (do NOT touch):
- `PLAN_LIMITS` numeric values (competitor caps, rescan limits, quotas).
- The `daily_adaptive` behaviour and `computeNextRun`'s staleness multiplier.
- The monthly-recap piggyback workaround. Real, related, but its own change.
- Stripe prices and the checkout flow.
- The `api` and `multiUser` flags. Already decided; do not reopen.

## Git workflow

- Branch: `feat/daily-priority-decision` off `main`.
- Commit message, HIDE: `fix(web): stop selling an unbuilt cadence`
- Commit message, DELIVER: `feat(queue): give business tier real priority`
- Do NOT push or open a pull request unless the operator instructed it.

## Steps

### Step 1: Measure what "deliver" would actually be worth, then recommend

This is the step that makes the decision honest. Answer these, with evidence:

1. **Does the scrape queue ever have a backlog?** Priority only matters when jobs
   wait. Look at how `schedule-scraping` fans out (it enqueues every due monitor
   on the hour) and at `SCRAPE_CONCURRENCY` (default 3). If hundreds of monitors
   are enqueued at once against a concurrency of 3, there is a real queue and
   priority is meaningful. If the queue drains in seconds, priority is a no-op
   dressed as a feature and HIDE is the honest answer.
2. **How many business-tier orgs exist?** If the answer is zero or one, delivering
   is speculative work and hiding is a one-line change. You cannot query
   production from here; ask, or state the assumption.
3. **What does the free tier lose?** Priority is zero-sum inside a bounded worker
   pool. Giving business a head start means free and starter monitors wait longer
   during the hourly burst. That is the intended semantics, but it should be a
   decision, not a surprise.

Write a short recommendation with the evidence. Then **stop and get the
operator's choice** before implementing either branch.

**Verify**: your report contains an answer to all three questions and a clear
recommendation.

### Step 2: Confirm pg-boss actually supports what "deliver" needs

If the recommendation is DELIVER, verify before building:

```bash
find node_modules/.pnpm -path "*pg-boss@*/dist/types.d.ts" | head -1 | xargs grep -n "priority"
grep -n "enqueue:" packages/queue/src/boss.ts
```

**Verify**: `priority` exists on the send options type, and `enqueue` forwards
options through. If it does not, DELIVER is not the cheap change this plan
claims and you should say so.

### Step 3A: HIDE (if chosen)

Remove the "Priority monitoring cadence" line from the business card in
`pricing.tsx`. Do not replace it with a vaguer claim; delete it.

Change the `usage-dashboard.tsx` label so a business customer is not told their
cadence is prioritised. Either map `daily_priority` to the same label as
`daily_adaptive`, or set the business tier's `scrapeFrequency` to
`daily_adaptive` and leave `daily_priority` in the type union unused.

Update the comment in `plans.ts` and the row in `docs/tier-limits.md` to say the
label is unused and why, so the next reader does not re-derive this.

Keep all copy English.

**Verify**: `grep -rn "Priority monitoring" apps/web/src` returns nothing;
`pnpm typecheck` exits 0; `pnpm test` exits 0.

### Step 3B: DELIVER (if chosen)

Add a small pure helper next to the existing plan helpers in
`packages/shared/src/constants/plans.ts`:

```ts
export function scrapePriorityForPlan(plan: Plan): number
```

Map tiers to pg-boss priority values (higher runs first). Keep it a pure
function of the plan, with a comment stating that priority is only meaningful
under backlog, and that it is zero-sum across tiers.

Then pass it at the enqueue site in `apps/workers/src/core/schedule-scraping.ts`,
which already knows each monitor's org and therefore its plan. If it does not
currently load the plan, that is the real cost of this option: measure it before
adding a per-monitor plan lookup to a fan-out that already runs over the whole
install base. A single grouped lookup, not one per monitor.

Write unit tests for the helper: each tier maps to a distinct value, ordering is
strictly business > pro > starter > free, and an unknown plan falls back to the
lowest priority rather than throwing.

Update `docs/tier-limits.md` so `daily_priority` is described as implemented,
with the date.

**Verify**: `cd packages/shared && bun test src` passes with the new tests;
`pnpm typecheck` exits 0; `pnpm test` exits 0.

### Step 4: Full check

**Verify**: `pnpm typecheck` exits 0 and `pnpm test` exits 0.

## Test plan

- **HIDE**: no new unit tests. The verification is the grep in step 3A plus the
  existing suites staying green. `packages/shared/src/constants/plans.test.ts`
  already covers the limit table and must still pass.
- **DELIVER**: new tests for `scrapePriorityForPlan` covering each tier, the
  strict ordering, and the unknown-plan fallback. Model on
  `packages/shared/src/constants/plans.test.ts` (pure table test).
- Neither option gets an end-to-end test that priority changes real scheduling
  order: that needs a live queue with a backlog. Say so in your report.

## Done criteria

Machine-checkable. ALL must hold, for whichever option was chosen:

**HIDE**
- [ ] `grep -rn "Priority monitoring" apps/web/src` returns nothing
- [ ] No user-facing surface labels the business cadence as prioritised
- [ ] `plans.ts` and `docs/tier-limits.md` state the label is unused
- [ ] `pnpm typecheck` exits 0, `pnpm test` exits 0

**DELIVER**
- [ ] `scrapePriorityForPlan` exists in `packages/shared` with tests that pass
- [ ] `schedule-scraping.ts` passes a priority on enqueue
- [ ] The plan lookup added there is grouped, not per-monitor
- [ ] `docs/tier-limits.md` describes `daily_priority` as implemented, with a date
- [ ] `pnpm typecheck` exits 0, `pnpm test` exits 0

**Both**
- [ ] Exactly one of 3A / 3B was implemented
- [ ] Your report records the operator's choice and the step-1 evidence
- [ ] No files outside the chosen option's in-scope list are modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The operator has not chosen between HIDE and DELIVER. **This is the default
  stopping point of this plan.** Step 1 produces a recommendation, not a decision.
- Step 1 shows the scrape queue never backs up. Then DELIVER ships a no-op and
  the recommendation must be HIDE; say so rather than building it.
- DELIVER would require a per-monitor database lookup inside the hourly fan-out.
  That is a real performance cost on the job that already touches every monitor;
  report the shape before adding it.
- pg-boss's `priority` turns out not to be forwarded by `enqueue`. Report it;
  do not modify the queue package's public surface as a side effect.
- You find another tier feature advertised with no implementation while working
  here. Report it separately; do not widen this plan.

## Maintenance notes

- **Whichever option is chosen, the pricing page and the code must agree from
  now on.** This is the third instance of the same drift (`api`, `multiUser`,
  `daily_priority`). The durable fix would be a test that every advertised
  feature string on the pricing page maps to a `PLAN_LIMITS` flag that is `true`.
  Worth considering as a follow-up; it would have caught all three.
- **If DELIVER is chosen**, watch free-tier scrape latency after deploy. Priority
  is zero-sum: business monitors moving up means everyone else moves down, and
  the free tier is the one with the least headroom.
- **The retired-constraint workarounds** (the monthly-recap piggyback at
  `packages/queue/src/jobs.ts:146` and its mirror in `docs/architecture.md:1265`)
  still cite the 10-cron cap that no longer exists. Sweeping them is a separate,
  small, satisfying change.
- A reviewer should check that no user-facing string survives that promises
  behaviour the code does not implement, in either option.
