# Plan 009: Stripe subscription webhooks act on live state, so a stale/duplicate event can't resurrect a cancelled plan

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result. If anything in "STOP conditions" occurs,
> stop and report. When done, update this plan's row in `plans/README.md` unless a
> reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 81c4b75..HEAD -- apps/api/src/routes/stripe-webhook.ts apps/api/src/lib/stripe.ts`
> If either changed, compare against the "Current state" excerpts before proceeding;
> on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (test step is stronger if 005/006 have landed, but not required)
- **Category**: bug (money path)
- **Planned at**: commit `81c4b75`, 2026-07-07

## Why this matters

The Stripe subscription webhook applies whatever subscription snapshot is embedded in
the event object, with no ordering guard and no dedup. Stripe does **not** guarantee
delivery order and re-delivers events. So a `customer.subscription.updated` with status
`active` that Stripe delivers *late* — after a `customer.subscription.deleted` — rewrites
a churned org **back to a paid plan** with a live `stripeSubscriptionId`. That is free
paid access plus a dangling subscription id that later billing code trusts. This is the
money path and it has zero tests. The fix: act on the subscription's **live** state
(re-retrieve it, as the checkout path already does) instead of the event's stale
snapshot, and don't let a delete of a superseded subscription free a re-subscribed org.

## Current state

`apps/api/src/routes/stripe-webhook.ts` — the two vulnerable branches:

```ts
// lines ~147-157: applies the event's embedded snapshot directly (no retrieve)
case "customer.subscription.updated":
case "customer.subscription.created": {
  const sub = event.data.object;                 // <-- stale snapshot from the event
  const orgId = await findOrgId(sub.metadata, sub.customer);
  if (!orgId) { logger.error(...); break; }
  await applyPlanFromSubscription(orgId, sub);
  break;
}

// lines ~159-180: frees the org unconditionally by orgId
case "customer.subscription.deleted": {
  const sub = event.data.object;
  const orgId = await findOrgId(sub.metadata, sub.customer);
  if (!orgId) { logger.error(...); break; }
  await db.update(organizations).set({
    plan: "free", planPeriod: null, stripeSubscriptionId: null, updatedAt: new Date(),
  }).where(eq(organizations.id, orgId));         // <-- no check that this is the org's CURRENT sub
  ...
}
```

The **correct** pattern already exists in the same file — `checkout.session.completed`
re-retrieves before applying (lines ~142-143):
```ts
const sub = await getStripe().subscriptions.retrieve(subId);
await applyPlanFromSubscription(orgId, sub);
```

`applyPlanFromSubscription` (lines 53-100) maps price → plan and intentionally keeps the
paid plan through the dunning window (`active | trialing | past_due` → paid; anything
else → `free`); it writes `stripeSubscriptionId: isActive ? sub.id : null`. **Do not
regress that dunning behavior.** The handler dependency-injects Stripe via `getStripe()`
/ `getWebhookSecret()` from `apps/api/src/lib/stripe.ts` — usable seams for testing.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0 |
| API tests | `pnpm --filter @outrival/api test` | all pass, incl. new webhook tests |
| Full suite | `pnpm test` | exit 0 |

## Scope

**In scope**:
- `apps/api/src/routes/stripe-webhook.ts`
- `apps/api/src/routes/stripe-webhook.test.ts` (create)

**Out of scope**:
- `applyPlanFromSubscription`'s plan-mapping / dunning logic — reuse it unchanged.
- `apps/api/src/routes/billing.ts` (change-plan/checkout/downgrade routes) — a separate
  test-coverage gap; do not modify here.
- Adding a persisted event-id/watermark table (a schema migration) — deferred hardening,
  noted in Maintenance. This plan is no-migration.

## Git workflow

- Branch: `advisor/009-stripe-webhook-ordering`
- Commit(s), conventional: `fix(billing): act on live subscription state in webhooks`.
- Do NOT push unless instructed.

## Steps

### Step 1: Re-retrieve live subscription state on `updated`/`created`

In the `customer.subscription.updated` / `customer.subscription.created` branch, resolve
the subscription id from the event, then **re-retrieve** it before applying — mirroring
the checkout path — so an out-of-order or duplicated event converges on Stripe's current
truth (a late `active` event for a since-cancelled sub re-retrieves as `canceled` →
`applyPlanFromSubscription` sets `free`):

```ts
case "customer.subscription.updated":
case "customer.subscription.created": {
  const evtSub = event.data.object;
  const orgId = await findOrgId(evtSub.metadata, evtSub.customer);
  if (!orgId) { logger.error({ type: event.type, subId: evtSub.id }, "subscription event: no orgId"); break; }
  // Re-retrieve so we act on live state, not the (possibly stale/out-of-order) event
  // snapshot. Stripe doesn't guarantee delivery order; a late `active` for a since-
  // cancelled sub must not resurrect a paid plan.
  const sub = await getStripe().subscriptions.retrieve(evtSub.id);
  await applyPlanFromSubscription(orgId, sub);
  break;
}
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Guard `deleted` against freeing a re-subscribed org

In the `customer.subscription.deleted` branch, only downgrade if the deleted subscription
is the org's **current** one — so a late delete of a superseded subscription can't free an
org that has since started a new subscription:

```ts
case "customer.subscription.deleted": {
  const sub = event.data.object;
  const orgId = await findOrgId(sub.metadata, sub.customer);
  if (!orgId) { logger.error({ subId: sub.id }, "customer.subscription.deleted: no orgId"); break; }
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { stripeSubscriptionId: true },
  });
  // Ignore a delete for a subscription the org has already replaced.
  if (org && org.stripeSubscriptionId && org.stripeSubscriptionId !== sub.id) {
    logger.warn({ orgId, deletedSub: sub.id, currentSub: org.stripeSubscriptionId },
      "Ignoring subscription.deleted for a superseded subscription");
    break;
  }
  await db.update(organizations).set({
    plan: "free", planPeriod: null, stripeSubscriptionId: null, updatedAt: new Date(),
  }).where(eq(organizations.id, orgId));
  // ... existing captureServerEvent("plan_cancelled") unchanged
  break;
}
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Add webhook tests

Create `apps/api/src/routes/stripe-webhook.test.ts`. Use the PGlite app/db harness (see
`apps/api/test/*harness*` — the same harness the existing API route tests use) to seed an
org, and stub Stripe via the `getStripe`/`getWebhookSecret` seams (or by constructing the
`Hono` app with a fake Stripe client — follow whatever injection the existing API tests
use for external clients). Cover:

1. `subscription.created` (active, known price) → org plan becomes the mapped paid plan,
   `stripeSubscriptionId` set.
2. `subscription.deleted` for the org's current sub → org plan back to `free`,
   `stripeSubscriptionId` null.
3. **Regression**: a `subscription.updated` (active) whose re-retrieved live status is
   `canceled`, arriving after a delete → org stays `free` (does NOT resurrect). Stub the
   retrieve to return `canceled`.
4. `subscription.deleted` for a **superseded** sub id (org's current
   `stripeSubscriptionId` differs) → org plan **unchanged** (not freed).
5. `past_due` status → org keeps the paid plan (dunning behavior preserved).

Model structure after an existing `apps/api/src/routes/*.test.ts`.

**Verify**: `pnpm --filter @outrival/api test` → all pass, including the 5 cases above.

## Test plan

- New file `stripe-webhook.test.ts` with the five cases in Step 3. Cases 3 and 4 are the
  direct regression guards for this plan; case 5 pins the dunning invariant so the fix
  doesn't regress it.
- Verification: `pnpm --filter @outrival/api test` → all pass.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm --filter @outrival/api test` passes, incl. the new webhook tests
- [ ] `updated`/`created` branch re-retrieves via `getStripe().subscriptions.retrieve(...)`
- [ ] `deleted` branch no-ops when the deleted sub id ≠ the org's current `stripeSubscriptionId`
- [ ] `past_due` still maps to a paid plan (case 5 passes)
- [ ] Only `stripe-webhook.ts` and its new test file changed (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report if:

- The existing API test harness cannot inject/stub the Stripe client without a source
  change beyond the webhook file — report the seam you need rather than modifying
  unrelated files.
- `applyPlanFromSubscription`'s signature or the dunning logic differs from the excerpt
  (drift) — do not rewrite it; report.
- Re-retrieving inside the handler would exceed Stripe rate limits in a way the existing
  checkout path doesn't already accept — report (the checkout path already retrieves, so
  this is unlikely).

## Maintenance notes

- **Deferred hardening** (needs a migration, out of scope here): persist the last-applied
  Stripe event `created` timestamp (or subscription `current_period`) per org and ignore
  events older than it. That closes the true concurrent-multi-subscription race that
  re-retrieve alone doesn't fully cover. Revisit if the product ever allows multiple
  concurrent subscriptions per org.
- Reviewer should scrutinize: that the re-retrieve didn't change the `findOrgId` inputs
  (still uses the event's metadata/customer to locate the org before retrieving), and
  that the dunning `past_due → paid` path is intact.
- This pairs with the billing-route test gap (TEST-03/05 from the audit) — a follow-up
  plan should cover `billing.ts` change-plan/downgrade with the same harness.
