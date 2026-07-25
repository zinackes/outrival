# Plan 022: Decide how a free workspace first encounters a paid capability, and specify the first move

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report, do not improvise. This plan is a **decision spike**: its deliverable is
> a measurement and a written recommendation, plus one small instrumentation fix.
> It does **not** build a trial or a new teaser. When done, update the status row
> for this plan in `plans/README.md`, unless a reviewer dispatched you and told
> you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 74888f6..HEAD -- packages/shared/src/constants/plans.ts apps/web/src/components/outrival/paywall-dialog.tsx apps/api/src/routes/billing.ts apps/workers/src/core/ai-visibility-teaser.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (the recommendation commits future work; the code change is small)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `74888f6`, 2026-07-25

## Why this matters

Measured in production over the last 180 days, the upgrade prompt fired for exactly
two reasons:

| paywall reason | events | people |
|---|---|---|
| `plan_locked_source` | 9 | 6 |
| `plan_limit_competitors` | 6 | 3 |

Nothing else. Never `plan_locked_feature`, never `plan_locked_frequency`, never
`plan_locked_channel`, never a tier-limit quota. Over the same period there were 15
`paywall_shown` events and **1** `paywall_cta_clicked`.

So the only upgrade pitch a free workspace ever meets is "you have hit a cap": add a
fourth competitor, add a source the plan does not include. It never meets a
*capability*. Real-time alerts, AI Visibility, webhooks and the higher battle-card
volume are all pro-or-above, and a free user has no path that puts them in front of
one, so the pitch is always "pay for more of the same" instead of "pay for something
you have now seen work". For an ICP described in `PRODUCT.md:13-20` as "Founders and
executives at B2B SaaS companies. Time-poor, not analysts", a quantity cap is the
least persuasive possible reason to enter a card.

Two candidate answers exist, and the repo already contains a working precedent for
one of them. `apps/workers/src/core/ai-visibility-teaser.ts` gives every new org a
single free run of a pro-only capability (AI Visibility), on a free provider tier,
with a one-run-ever guard and a kill switch. It was built once and never generalized.

Choosing between "time-boxed trial" and "generalized teaser" is a business decision
with real, asymmetric costs, and it should be made from the numbers rather than by
whichever gets built first. This plan produces those numbers, writes the decision,
and fixes the one instrumentation gap that would otherwise keep the funnel blind.

## Current state

### The tier grid (the source of truth)

`packages/shared/src/constants/plans.ts` holds `PLAN_LIMITS`, the single source for
every per-tier limit. The free tier, lines 68-83:

```ts
  free: {
    maxCompetitors: 2,
    allowedFrequencies: ["weekly"],
    allowedChannels: ["email"],
    allowedSources: ["homepage", "pricing", "blog"],
    scrapeFrequency: "weekly",
    forcedRescansPerDay: 1,
    battleCardsPerDay: 1,
    discoveriesPerMonth: 3,
    standingQueries: 3,
    customMonitorsPerCompetitor: 0,
    usersPerOrg: 1,
    historyRetentionDays: 7,
    // Battle cards now open to every tier, governed by battleCardsPerDay (not a hard gate).
    features: { battleCards: true, realtimeAlerts: false, api: false, multiUser: false, fullMode: false, crmIntegrations: false, aiVisibility: false },
  },
```

`api` and `multiUser` are `false` on **every** tier including business, which is
correct and deliberate: `docs/paid-feature-delivery.md` records the decision to stop
advertising two capabilities no code delivers. Do not reverse that.

### The paywall, and the gap in it

`apps/web/src/components/outrival/paywall-dialog.tsx:32-70` has two parsers:

```ts
export function paywallFromError(err: unknown): PaywallReason | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status !== 403) return null;
  const code = typeof err.code === "string" ? err.code : null;
  if (!code || !code.startsWith("plan_")) return null;
  ...
}

// Per-tier *quota* limits (battle cards/day, discoveries/month) come back as a 429
// with a tierLimitBody payload — distinct from the 403 `plan_*` feature/source locks
// that paywallFromError handles. Same dialog, just a quota-aware copy + an upgrade
// suggestion. Scoped to the tierLimitBody codes; the forced-rescan and AI rate-limit
// 429s carry their own shapes and are handled at their call sites.
const TIER_LIMIT_CODES = ["battlecard_limit_reached", "discovery_limit_reached"] as const;

export function tierLimitFromError(err: unknown): PaywallReason | null { ... }
```

And the tracking, at line 182:

```ts
    if (reason) track("paywall_shown", { reason: reason.code });
```

The `track` call sits in the dialog, so any path that surfaces a limit **without**
opening this dialog is invisible to the funnel. The comment at line 53 names two
such paths explicitly: "the forced-rescan and AI rate-limit 429s carry their own
shapes and are handled at their call sites". A free workspace is capped at
`forcedRescansPerDay: 1`, so that is a limit free users plausibly hit, and it does
not appear in the funnel at all. Step 1 closes that.

### The teaser precedent

`apps/workers/src/core/ai-visibility-teaser.ts:19-24`:

```ts
// AI Visibility onboarding TEASER (Lever 7, docs/post-onboarding-activation.md). A
// ONE-TIME, free "share of model" taste at day 0: does the user's product show up in
// AI answer engines for buyer-intent questions in its category — and how often vs its
// top competitor? Runs on the FREE Gemini grounding tier (never a paid call without an
// explicit key). Best-effort and terminal: it always writes exactly one row per org
// (status ready|unavailable), so the day-0 card resolves instead of polling forever.
```

Its three load-bearing properties, lines 37-67: a **terminal writer** (exactly one
row per org, so the UI resolves rather than polling forever), a **one-run-ever
guard** (the row's presence is the flag), and **two kill switches**. Any
generalization must keep all three.

### Billing, as it stands

`apps/api/src/routes/billing.ts:240-252`:

```ts
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${base}/dashboard/settings/billing?status=success`,
    cancel_url: `${base}/dashboard/settings/billing?status=cancelled`,
    client_reference_id: orgId,
    metadata: { orgId, plan: parsed.data.plan, period: parsed.data.period },
    subscription_data: {
      metadata: { orgId, plan: parsed.data.plan, period: parsed.data.period },
    },
    allow_promotion_codes: true,
  });
```

No `trial_period_days`, and `grep -rn "trial_period_days\|trialPeriodDays" apps/`
returns nothing. There is no trial anywhere in the product today.

### Conventions that apply

- `PLAN_LIMITS` is the **single source of truth** for every per-tier limit
  (`docs/tier-limits.md`). No parallel table, no second grid. If the recommendation
  touches limits, it changes that file and nothing else.
- Plan gates return **structured error codes**, parsed by the web into the paywall.
  New codes must follow the existing `plan_*` / `*_limit_reached` shapes.
- PostHog events are gated by consent: the `track` helper is a no-op when the user
  has not opted in. A new event inherits that automatically.
- **English only** for anything user-visible (`.claude/rules/language.md`).
- No em-dashes in prose you write; rephrase instead of substituting a hyphen.

## Commands you will need

| Purpose   | Command                            | Expected on success |
|-----------|------------------------------------|---------------------|
| Typecheck | `pnpm typecheck`                   | exit 0, 8 tasks     |
| Tests     | `pnpm test`                        | exit 0, all pass    |

**Environment gotcha**: `turbo` is not on `PATH`; a bare `turbo typecheck` prints
`turbo: command not found` and reads as silence when piped. Use the `pnpm` scripts.

**Do not run `pnpm build`**: a full web build exhausts RAM on the WSL2 dev box.

## Scope

**In scope**:
- `apps/web/src/components/outrival/paywall-dialog.tsx` (step 1 only, the
  forced-rescan and AI rate-limit codes)
- The call sites that handle those two 429 shapes (find them with the grep in
  step 1; expect one or two files under `apps/web/src`)
- `docs/monetization-first-encounter.md` (create)

**Out of scope** (do NOT touch):
- `packages/shared/src/constants/plans.ts`. Changing a tier limit is the *outcome*
  of the decision, not part of the spike. Do not tune a single number here.
- `apps/api/src/routes/billing.ts` and anything Stripe. Adding a trial is one of the
  two options under evaluation; implementing it before the decision is written
  defeats the plan.
- `apps/workers/src/core/ai-visibility-teaser.ts` and the `ai_visibility_teasers`
  table. Read it as the precedent; do not refactor it into a framework.
- `packages/shared/src/feature-flags.ts` and the `api` / `multiUser` flags. Decided
  in `docs/paid-feature-delivery.md`, stays decided.
- Any new capability, any new AI call, any pricing change.

## Git workflow

- Branch: `advisor/022-first-paid-encounter`
- Conventional Commits, subject at most 50 chars, imperative. Example from
  `git log`: `feat(web): mark brand names in AI answers (#266)`.
  Suggested: `fix(web): track every limit a free plan hits`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Make every limit encounter visible to the funnel

Find the two call sites the paywall comment names:

```bash
grep -rn "forced_rescan\|rescan_limit\|rate_limit" apps/web/src --include=*.ts --include=*.tsx
```

For each place a 429 limit is surfaced to the user **without** opening
`PaywallDialog`, emit the same event the dialog emits, with a distinguishing reason
code:

```ts
track("paywall_shown", { reason: "<the api error code>" });
```

Do not change the user-visible behaviour of those call sites. Do not route them
through the dialog. The only change is that the funnel stops being blind to them:
today a free workspace that burns its single daily forced rescan produces no
analytics event at all, so the most likely free-tier friction point is unmeasurable.

If the grep shows those 429s are never surfaced in the UI, record that instead and
skip the code change; that is a finding, not a failure.

**Verify**: `pnpm typecheck` → exit 0, and
`grep -rn 'track("paywall_shown"' apps/web/src` returns at least 2 matches (the
dialog plus at least one call site).

### Step 2: Measure the free-tier surface

No code. Using the product analytics available to the operator (PostHog, project
"Default project"), record over 180 days:

1. `paywall_shown` broken down by `reason` (the known baseline is
   `plan_locked_source` 9 and `plan_limit_competitors` 6; confirm it is unchanged).
2. `paywall_cta_clicked` count, and `checkout_initiated` count.
3. How many organizations are on `free` today, and how many have ever hit any limit.
4. Whether any org ever saw a `plan_locked_feature` event. The expectation is zero.

The query shape for the first, which works as written:

```sql
SELECT properties.reason AS reason, count() AS n, uniq(person_id) AS people
FROM events
WHERE timestamp >= now() - INTERVAL 180 DAY AND event = 'paywall_shown'
GROUP BY reason ORDER BY n DESC
```

If you cannot reach the analytics project, STOP and report. Do not substitute
estimates: the entire value of this plan is that the decision is made from measured
numbers rather than intuition.

**Verify**: the four numbers are written down.

### Step 3: Write the decision

Create `docs/monetization-first-encounter.md`. Structure it exactly like
`docs/paid-feature-delivery.md`, which is the repo's existing precedent for a
"what is sold vs what exists, decide" document: state the measured facts, lay out
each option with its real cost, then make one call and say what to do this week.

It must contain:

**1. The measurement** from step 2, as a table, with the date.

**2. The problem in one paragraph**: every upgrade prompt in production is a
quantity cap; no free workspace has ever encountered a paid capability.

**3. Option A, time-boxed trial.** Add `trial_period_days` to the Stripe checkout,
or grant a pro entitlement for N days at signup. Cost: a new entitlement state
(trialing) that every gate must respect, trial-expiry handling, dunning, and a
Stripe webhook path that does not exist today (`stripe-webhook.ts` handles
subscription lifecycle; a trial adds `trial_will_end`). Benefit: the standard,
well-understood motion, and it puts the user inside the full product.

**4. Option B, generalized teaser.** Apply the `ai-visibility-teaser` pattern to
each paid capability: one free sample, capped, guarded by a one-row-per-org table,
with a kill switch. Cost: one implementation per capability, and the sample must be
genuinely useful or it reads as a demo. Benefit: no billing surface, no entitlement
state, no expiry, and it works on a free tier that has zero paying users to protect.

**5. The recommendation**, in one sentence, with the reason. Base it on the numbers,
not on preference. As guidance, not a conclusion to copy: at the measured volume
(15 paywall views, 1 CTA click, in 180 days) the binding constraint is that almost
nobody reaches a gate at all, which argues that neither option is the first move
until more workspaces reach one. If the numbers say that, say it, and name what
would change the answer.

**6. The specified first move**, concrete enough for a follow-up plan to execute
without re-deciding anything: which capability, which surface, which cap, which kill
switch, which table. One move, not a program.

**7. Explicitly not chosen**, with reasons, so nobody re-litigates: any change to
`PLAN_LIMITS` values, any reintroduction of `features.api` or `features.multiUser`,
and any pricing change.

**Verify**: `test -f docs/monetization-first-encounter.md` and the file contains all
seven sections.

### Step 4: Link it

Add a one-line reference to the new doc from `docs/tier-limits.md`, matching the
`📄 docs/<file>.md` style used across the repo's docs.

**Verify**: `grep -n "monetization-first-encounter" docs/tier-limits.md` returns one
match.

## Test plan

- No new tests. Step 1 adds analytics calls to existing error branches, which the
  repo does not unit-test elsewhere (the existing `track("paywall_shown")` call in
  `paywall-dialog.tsx:182` has no test either); adding a test harness for PostHog
  calls is out of proportion to a two-line change.
- Regression guard: `pnpm typecheck` and `pnpm test` must both stay green, proving
  the call sites still compile and nothing else moved.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0 (no new failures against the pre-change baseline)
- [ ] `grep -rn 'track("paywall_shown"' apps/web/src` returns at least 2 matches, or
      the doc records that the 429 paths are never surfaced in the UI
- [ ] `docs/monetization-first-encounter.md` exists with all seven sections, real
      measured numbers, and exactly one recommendation
- [ ] `docs/tier-limits.md` links it
- [ ] `packages/shared/src/constants/plans.ts` is **unmodified**
      (`git diff --stat` shows it absent)
- [ ] `apps/api/src/routes/billing.ts` is **unmodified**
- [ ] `git status` shows no modified file outside the in-scope list
- [ ] `plans/README.md` status row for 022 updated

## STOP conditions

Stop and report back (do not improvise) if:

- You cannot reach the analytics project to complete step 2.
- `paywall-dialog.tsx:32-70` does not match the excerpts (the parsers changed shape).
- Step 1's grep shows more than three call sites handling bare 429 limits. That is a
  larger inconsistency than this plan budgets for; report the list rather than
  editing them all.
- You conclude the recommendation requires changing a `PLAN_LIMITS` value to be
  testable. Write the recommendation; do not make the change.
- You are tempted to implement Option A or Option B "since it is small". Neither is
  in scope. The plan's value is the decision, and a half-built trial is worse than
  none.

## Maintenance notes

- The reason codes emitted in step 1 become part of the funnel's vocabulary.
  Renaming one later breaks the historical series; add new codes rather than
  renaming.
- Whoever executes the chosen option should re-read
  `apps/workers/src/core/ai-visibility-teaser.ts:37-67` first. Its three properties
  (terminal writer, one-run-ever guard, kill switch) are what stop a free sample
  from becoming an unbounded cost or a card that polls forever. A generalization
  that drops any of the three will regress in production, not in review.
- If a trial is ever chosen, the gate to scrutinize is `isFeatureAllowed` in
  `apps/api/src/lib/plan.ts`: a trialing org must resolve to its trial tier
  everywhere, and the current signature takes a plan, not an entitlement state.
- Deliberately deferred: pricing itself, annual/monthly mix, and promotion codes.
  `allow_promotion_codes: true` is already set in checkout, so a discount motion
  exists without any code change if one is ever wanted.
