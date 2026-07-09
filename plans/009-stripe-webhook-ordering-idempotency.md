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
- `apps/api/test/stripe-webhook.test.ts` (create — **the api `test` script runs `bun test test/`,
  so the test MUST live in `apps/api/test/`, NOT `src/routes/`, or it silently never runs**)

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

Create **`apps/api/test/stripe-webhook.test.ts`** (NOT under `src/routes/` — the api suite globs
`test/`, so a file elsewhere silently never runs). Model it on `apps/api/test/products.test.ts`:
`makeTestDb()` (PGlite) → `installAppMocks(testDb)` → `mountApp(...)` → `seedOrg`. The webhook is
**unauthenticated** (Stripe signature, not a user session), so POST a raw JSON body + a
`stripe-signature` header (no `asUser`).

**The harness does NOT stub Stripe** — `installAppMocks` only swaps `@outrival/db` / auth. Add your
own Stripe module mock **in the same `beforeAll`, BEFORE importing the router**, mirroring how
`installAppMocks` swaps `@outrival/db` (spread `{ ...realStripe, … }` so the real `lookupPlanByPriceId`
/ `getPriceId` stay — `applyPlanFromSubscription` maps price→plan through them):

```ts
import { mock } from "bun:test";
import { resolve } from "node:path";

let nextEvent: any;       // what constructEventAsync yields (the "received" event)
let retrieveResult: any;  // what subscriptions.retrieve returns (the LIVE state the fix reads)

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);
  const realStripe = await import("../src/lib/stripe");
  mock.module(resolve(import.meta.dir, "../src/lib/stripe"), () => ({
    ...realStripe,                                   // keep lookupPlanByPriceId/getPriceId real
    getWebhookSecret: () => "whsec_test",
    getStripe: () => ({
      webhooks: { constructEventAsync: async () => nextEvent },  // skip real HMAC
      subscriptions: { retrieve: async () => retrieveResult },
    }),
  }));
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_monthly_test"; // so a known price → "pro"
  const { stripeWebhookRouter } = await import("../src/routes/stripe-webhook"); // confirm export name
  app = mountApp("/api/stripe/webhook", stripeWebhookRouter);
});
```

Each test sets `nextEvent` (and `retrieveResult` for `updated`/`created`), seeds/updates the org,
POSTs to the mounted path with any non-empty body + `stripe-signature: test`, then asserts the org
row. A fake subscription is a plain object with the fields `applyPlanFromSubscription` reads — open
it (lines ~53-100) and match its exact shape (at minimum `id`, `status`, the price id it reads via
`lookupPlanByPriceId`, `metadata`, `customer`); set the price id to your `STRIPE_PRICE_PRO_MONTHLY`
value so it maps to `pro`.

Cover:
1. `subscription.created` (active, known price) → org plan becomes the mapped paid plan,
   `stripeSubscriptionId` set. (`retrieveResult` = the active sub.)
2. `subscription.deleted` for the org's current sub → org plan back to `free`, `stripeSubscriptionId` null.
3. **Regression**: a `subscription.updated` (event says active) whose **re-retrieved** live status is
   `canceled` → org stays/goes `free` (does NOT resurrect). Set `retrieveResult.status = "canceled"`.
4. `subscription.deleted` for a **superseded** sub id (org's current `stripeSubscriptionId` differs)
   → org plan **unchanged** (not freed).
5. `past_due` status → org keeps the paid plan (dunning preserved). (`retrieveResult.status = "past_due"`.)

**Caution — Bun `mock.module` is process-global (the repo's known leak):** keep the fake behavior in
the mutable `nextEvent`/`retrieveResult` closure vars set per test; establish the module mock ONCE in
`beforeAll` (consistent with `installAppMocks`), do not re-`mock.module` per test. If the
`../src/lib/stripe` mock visibly reddens another api test file, STOP and report (the seam issue).

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
