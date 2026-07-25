# First paid-capability encounter: decision

Companion to `docs/paid-feature-delivery.md` (same shape: measured facts, options
with real cost, one call). That doc asked what to do about capabilities we sell but
don't deliver. This one asks the opposite question: what does a **free** workspace
ever see of what it would be paying for, and what's the first move.

## 1. The measurement (2026-07-26, 180 days unless noted)

**Paywall funnel:**

| event | reason | events | people |
|---|---|---|---|
| `paywall_shown` | `plan_locked_source` | 9 | 6 |
| `paywall_shown` | `plan_limit_competitors` | 6 | 3 |
| `paywall_cta_clicked` | `plan_locked_source` | 1 | 1 |
| `checkout_initiated` | (any) | 12 | 11 |
| `plan_upgraded` | (any) | 37 | 11 |
| `user_signed_up` | (any) | 24 | 24 |

No `plan_locked_feature` event has ever fired. Confirmed unchanged from the
baseline in this plan's "Why this matters" section.

**Organizations, today:**

| plan | orgs | onboarded |
|---|---|---|
| free | 24 | 20 |
| starter | 2 | 2 |
| pro | 7 | 7 |
| business | 3 | 3 |

12 of 36 organizations (33%) are on a paid plan.

**Organizations at or over their competitor cap, today:**

| plan | cap | orgs at/over cap |
|---|---|---|
| free | 2 | 19 |
| starter | 5 | 1 |
| pro | 15 | 1 |

19 of 24 free organizations (79%) sit at or over `maxCompetitors`.

**Forced re-scans, last 30 days:** 38 by 9 distinct users, against a free cap of 1/day
(`PLAN_LIMITS.free.forcedRescansPerDay`). Step 1 of this plan makes this path visible
to the `paywall_shown` funnel going forward; it produced zero events before that fix.

## 2. The problem, in one paragraph

Every upgrade prompt that has ever fired in production is a quantity cap
(`plan_locked_source`, `plan_limit_competitors`); no free workspace has ever seen a
`plan_locked_feature` prompt, meaning no free workspace has ever been shown a paid
*capability* (real-time alerts, AI Visibility, webhooks, the higher battle-card
volume) working. The only pitch a free user meets is "pay for more of the same,"
never "pay for something you've now seen do something for you."

## 3. Option A: time-boxed trial

Add `trial_period_days` to the Stripe checkout session in
`apps/api/src/routes/billing.ts:240-252`, or grant a pro entitlement for N days at
signup.

**Cost:** a new entitlement state (`trialing`) that every gate must respect.
`isFeatureAllowed(plan: Plan, feature: PlanFeature)` in `apps/api/src/lib/plan.ts:89`
takes a `Plan`, not an entitlement state, so a trial cannot just pass through it
today: every call site needs to resolve a trialing org to its trial tier, or the
signature itself needs to grow a state parameter. It also needs trial-expiry
handling (what happens to a competitor list built past the free cap when the trial
ends), dunning, and a Stripe webhook path that doesn't exist yet:
`apps/api/src/routes/stripe-webhook.ts` handles subscription lifecycle events, but a
trial adds `customer.subscription.trial_will_end` and the "did the org convert or
lapse" branch that follows it.

**Benefit:** the standard, well-understood SaaS motion, and it puts the user inside
the *whole* product rather than a sample of one part of it.

## 4. Option B: generalized teaser

Apply the `ai-visibility-teaser` pattern (`apps/workers/src/core/ai-visibility-teaser.ts`)
to other paid capabilities: one free sample, capped, guarded by a one-row-per-org
table, with a kill switch. Its three load-bearing properties (lines 37-67): a
**terminal writer** (`writeTeaser`, exactly one row per org via `onConflictDoUpdate`,
so the UI resolves to `ready` or `unavailable` instead of polling forever), a
**one-run-ever guard** (the row's presence is the flag, checked before any paid call
is made), and **two kill switches** (`AI_VISIBILITY_ENABLED`,
`AI_VISIBILITY_TEASER_ENABLED`).

**Cost:** one implementation per capability, each needing its own version of all
three properties, and the sample must be genuinely useful (a real, if narrow,
capability outcome) or it reads as a demo screenshot rather than a taste of the
product.

**Benefit:** no billing surface, no entitlement state, no expiry logic, and it works
on a free tier that has zero paying subscriptions to protect from a bad trial
experience.

## 5. The recommendation

**Recommendation: instrument and fix the silent competitor-cap wall in onboarding
before building either option, because it is where free organizations are actually
meeting the limit today, invisibly.**

The reasoning: 19 of 24 free organizations (79%) sit at or over the 2-competitor cap
right now, yet the `plan_limit_competitors` paywall has fired only 6 times for 3
people in 180 days. Those two facts cannot both describe "the wall works and almost
nobody reaches it". If the paywall reliably fired every time a free org's competitor
count hit the ceiling, a population this large sitting at the ceiling would have
produced far more than 6 events. The gap says the wall is being reached constantly
and *not producing an encounter* for most of the organizations sitting against it.

Reading `apps/web/src/app/(onboarding)/onboarding/onboarding-form.tsx` confirms a
concrete mechanism, not just a guess. Two different code paths enforce the same
cap with two different user experiences:

- A user who manually toggles a competitor past the cap, or types a manual URL past
  it, hits `showCompetitorLimitPaywall()` (`onboarding-form.tsx:606-608`), which opens
  the real dialog and fires `paywall_shown`. This is the 6-event path.
- The **automatic** discovery selection, `applyDiscovered()` (`onboarding-form.tsx:462`),
  pre-checks matches up to the cap with `picked < maxCompetitors` and silently stops.
  No dialog, no event, no explanation. The step does show a passive `N / maxCompetitors`
  counter (`DiscoverStep`, `onboarding-form.tsx:1416-1418`), but nothing tells the user
  that stronger, unchecked matches exist below the fold or that a paid plan would
  track them. For an ICP described as "time-poor, not analysts" (`PRODUCT.md:13-20`),
  landing on a step that already reads "2 / 2 selected" and clicking Continue is the
  path of least resistance, and it is a path that never meets the paywall.

This is a hypothesis about *how much* of the 79% never encounters the wall this way,
not a proven count (there is no per-organization trace of which onboarding path each
free org took). But it is a verified code-level mechanism, not speculation about
mechanism, and it is sufficient to explain why the measured encounter rate is so far
below the population sitting at the cap.

Two more numbers keep this from overreaching in either direction:

- **12 of 36 organizations (33%) already pay.** Conversion is not zero, so "nobody
  pays" is not the finding here and would be the wrong frame for whatever comes
  next. `checkout_initiated`/`plan_upgraded` (11-12 people) also dwarfs
  `paywall_cta_clicked` (1 person), meaning almost none of today's paid conversions
  are attributable to the in-app paywall dialog at all; whatever *is* driving them
  (direct billing-page visits, sales, plan curiosity) is orthogonal to this
  encounter question and out of scope here.
- **38 forced re-scans by 9 users in 30 days**, against a free cap of 1/day, is real,
  frequent traffic against exactly the 429 path Step 1 of this plan just instrumented.
  It is independent evidence that at least a meaningful slice of free users are
  pushing on a real daily limit right now, which argues Step 1 (already done) was
  worth doing regardless of what's decided here.

Neither trial nor teaser is the first move: both are ways to make an upgrade pitch
more persuasive, and that only matters once the pitch is actually delivered to the
79% of free organizations sitting at the wall it's supposed to come from. Building
either now would be optimizing the sales pitch for a room most of the audience never
walks into.

## 6. The specified first move

**Make the onboarding auto-select cap produce the same encounter the manual path
already gets, and tag the encounter by where it happened so this can be measured
going forward.**

- **Capability:** none new. Reuses the existing `plan_limit_competitors` paywall
  (`PaywallDialog`, `showCompetitorLimitPaywall()`) that the manual toggle path
  already opens correctly.
- **Surface:** `apps/web/src/app/(onboarding)/onboarding/onboarding-form.tsx`,
  the `applyDiscovered()` auto-select (currently silent) and `DiscoverStep`
  (currently a passive counter). When discovery finds more qualifying matches
  (`overlapScore > 60`) than `maxCompetitors` allows, surface that explicitly, e.g.
  a persistent line under the counter ("3 more strong matches found; upgrade to
  track them") backed by one `showCompetitorLimitPaywall()`-equivalent call the first
  time that happens for the session, not a modal that interrupts the flow the user
  is already mid-completing.
- **Cap:** unchanged. This does not touch `PLAN_LIMITS` or `maxCompetitors`.
- **Kill switch:** none needed. This is additive UI plus one analytics call, the same
  scale of change as Step 1 of this plan; nothing to revert but a UI string and an
  event.
- **Table:** none new. Reuses `paywall_shown` with the existing `plan_limit_competitors`
  reason code, extended with a distinguishing property, e.g.
  `track("paywall_shown", { reason: "plan_limit_competitors", surface: "onboarding_auto_select" })`,
  so the next 180-day read can tell whether the auto-select encounter converts
  differently from the manual one, which is the open question this plan could not
  answer from existing data alone.

A follow-up plan implementing this should re-measure the funnel after a few weeks
live before deciding anything further; if tagged encounters still don't convert,
that is the actual evidence for or against Option A/B, not the current numbers.

## 7. Explicitly not chosen

- **No change to any `PLAN_LIMITS` value.** `packages/shared/src/constants/plans.ts`
  is unmodified by this plan and untouched by the recommendation above; the
  competitor cap itself is not in question, only whether hitting it is visible.
- **No reintroduction of `features.api` or `features.multiUser`.** Decided in
  `docs/paid-feature-delivery.md`; nothing here reopens it.
- **No pricing change.** Deliberately out of scope, same as the plan that produced
  this doc. `allow_promotion_codes: true` is already set in Stripe checkout, so a
  discount motion exists without any code change if one is ever wanted.
- **Neither Option A nor Option B, for now.** Not rejected outright: if the
  instrumented onboarding encounter (section 6) still doesn't move conversion once
  it's actually reaching the 79% of free orgs at the wall, that result, not this
  plan's numbers, is what should decide between a trial and a teaser next.
