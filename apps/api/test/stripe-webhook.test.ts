import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { mock } from "bun:test";
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { organizations } from "@outrival/db";
import { makeTestDb, type TestDb } from "./db-harness";
import { installAppMocks, mountApp, seedOrg } from "./app-harness";

// The subscription webhook applies whatever snapshot Stripe embeds in the event —
// Stripe does NOT guarantee delivery order and re-delivers events, so a late
// `active` `updated` event for a since-cancelled sub could resurrect a churned
// org to a paid plan. The fix re-retrieves the subscription's LIVE state (mirrors
// the checkout.session.completed path) before applying it, and the `deleted`
// branch no-ops when the deleted sub isn't the org's current one. Cases 3 and 4
// below are the direct regression guards; case 5 pins the dunning invariant
// (`past_due` keeps the paid plan) so the fix doesn't regress it.
let app: Hono;
let testDb: TestDb;
let closeDb: () => Promise<void>;

// Set per test right before posting: `nextEvent` is what constructEventAsync
// "receives" from Stripe, `retrieveResult` is what subscriptions.retrieve
// returns — the LIVE state the fix reads instead of the event's own snapshot.
let nextEvent: any;
let retrieveResult: any;

const PRICE_PRO_MONTHLY = "price_pro_monthly_test";

afterAll(() => closeDb());

beforeAll(async () => {
  ({ db: testDb, close: closeDb } = await makeTestDb());
  await installAppMocks(testDb);

  process.env.STRIPE_PRICE_PRO_MONTHLY = PRICE_PRO_MONTHLY;

  const realStripe = await import("../src/lib/stripe");
  mock.module(resolve(import.meta.dir, "../src/lib/stripe"), () => ({
    ...realStripe, // keep lookupPlanByPriceId/getPriceId real so price→plan mapping is genuine
    getWebhookSecret: () => "whsec_test",
    getStripe: () => ({
      webhooks: { constructEventAsync: async () => nextEvent }, // skip real HMAC verification
      subscriptions: { retrieve: async () => retrieveResult },
    }),
  }));

  const { stripeWebhookRouter } = await import("../src/routes/stripe-webhook");
  app = mountApp("/api/stripe/webhook", stripeWebhookRouter);
});

function makeSub(orgId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_test",
    status: "active",
    customer: "cus_test",
    metadata: { orgId },
    items: { data: [{ price: { id: PRICE_PRO_MONTHLY } }] },
    ...overrides,
  };
}

async function post() {
  return app.request("/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "test" },
    body: JSON.stringify({ any: "body" }), // content is irrelevant — constructEventAsync is stubbed
  });
}

async function getOrg(orgId: string) {
  return testDb.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
}

describe("stripe subscription webhooks act on live state", () => {
  test("1. subscription.created (active, known price) sets the mapped paid plan", async () => {
    const { orgId } = await seedOrg(testDb, { plan: "free" });
    const sub = makeSub(orgId, { id: "sub_1" });
    nextEvent = { type: "customer.subscription.created", data: { object: sub } };
    retrieveResult = sub;

    const res = await post();
    expect(res.status).toBe(200);

    const org = await getOrg(orgId);
    expect(org?.plan).toBe("pro");
    expect(org?.planPeriod).toBe("monthly");
    expect(org?.stripeSubscriptionId).toBe("sub_1");
  });

  test("2. subscription.deleted for the org's current sub frees the plan", async () => {
    const { orgId } = await seedOrg(testDb, { plan: "pro" });
    await testDb
      .update(organizations)
      .set({ stripeSubscriptionId: "sub_2", planPeriod: "monthly" })
      .where(eq(organizations.id, orgId));

    nextEvent = {
      type: "customer.subscription.deleted",
      data: { object: makeSub(orgId, { id: "sub_2" }) },
    };

    const res = await post();
    expect(res.status).toBe(200);

    const org = await getOrg(orgId);
    expect(org?.plan).toBe("free");
    expect(org?.planPeriod).toBeNull();
    expect(org?.stripeSubscriptionId).toBeNull();
  });

  test("3. regression: a late `updated` event does NOT resurrect a cancelled sub", async () => {
    const { orgId } = await seedOrg(testDb, { plan: "free" });

    // The event snapshot claims `active` (stale/out-of-order), but the
    // re-retrieved LIVE state is `canceled` — the fix must act on the retrieve,
    // not the event's embedded object.
    nextEvent = {
      type: "customer.subscription.updated",
      data: { object: makeSub(orgId, { id: "sub_3", status: "active" }) },
    };
    retrieveResult = makeSub(orgId, { id: "sub_3", status: "canceled" });

    const res = await post();
    expect(res.status).toBe(200);

    const org = await getOrg(orgId);
    expect(org?.plan).toBe("free");
    expect(org?.stripeSubscriptionId).toBeNull();
  });

  test("4. regression: subscription.deleted for a superseded sub id does not free the org", async () => {
    const { orgId } = await seedOrg(testDb, { plan: "pro" });
    await testDb
      .update(organizations)
      .set({ stripeSubscriptionId: "sub_current", planPeriod: "monthly" })
      .where(eq(organizations.id, orgId));

    // Deleted event references an OLD subscription id — the org has since
    // re-subscribed and its current sub is "sub_current".
    nextEvent = {
      type: "customer.subscription.deleted",
      data: { object: makeSub(orgId, { id: "sub_old" }) },
    };

    const res = await post();
    expect(res.status).toBe(200);

    const org = await getOrg(orgId);
    expect(org?.plan).toBe("pro");
    expect(org?.stripeSubscriptionId).toBe("sub_current");
  });

  test("5. past_due keeps the paid plan (dunning window preserved)", async () => {
    const { orgId } = await seedOrg(testDb, { plan: "free" });
    const sub = makeSub(orgId, { id: "sub_5", status: "past_due" });
    nextEvent = { type: "customer.subscription.updated", data: { object: sub } };
    retrieveResult = sub;

    const res = await post();
    expect(res.status).toBe(200);

    const org = await getOrg(orgId);
    expect(org?.plan).toBe("pro");
    expect(org?.planPeriod).toBe("monthly");
    expect(org?.stripeSubscriptionId).toBe("sub_5");
  });
});
