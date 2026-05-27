import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { organizations } from "@outrival/db";
import { logger } from "@outrival/shared";
import type { Plan } from "@outrival/shared";
import { db } from "../lib/db";
import {
  getStripe,
  getWebhookSecret,
  lookupPlanByPriceId,
  type StripeClient,
} from "../lib/stripe";

export const stripeWebhookRouter = new Hono();

type StripeEvent = ReturnType<StripeClient["webhooks"]["constructEvent"]>;
type StripeSubscription = Extract<
  StripeEvent,
  { type: "customer.subscription.created" }
>["data"]["object"];
type StripeCheckoutSession = Extract<
  StripeEvent["data"]["object"],
  { object: "checkout.session" }
>;
type StripeCustomerRef = StripeSubscription["customer"];

async function findOrgId(
  metadata: Record<string, string> | null | undefined,
  customer: StripeCustomerRef | StripeCheckoutSession["customer"] | null,
): Promise<string | null> {
  const fromMeta = metadata?.orgId;
  if (fromMeta) return fromMeta;
  const customerKey =
    typeof customer === "string" ? customer : customer?.id ?? null;
  if (!customerKey) return null;
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.stripeCustomerId, customerKey),
    columns: { id: true },
  });
  return org?.id ?? null;
}

async function applyPlanFromSubscription(orgId: string, sub: StripeSubscription) {
  const priceId = sub.items.data[0]?.price?.id;
  if (!priceId) {
    logger.error({ subId: sub.id }, "Subscription has no price id");
    return;
  }
  const mapped = lookupPlanByPriceId(priceId);
  if (!mapped) {
    logger.error({ priceId, subId: sub.id }, "Unknown price id");
    return;
  }
  const isActive = sub.status === "active" || sub.status === "trialing";
  const plan: Plan = isActive ? mapped.plan : "free";

  await db
    .update(organizations)
    .set({
      plan,
      planPeriod: isActive ? mapped.period : null,
      stripeSubscriptionId: isActive ? sub.id : null,
      stripeCustomerId:
        typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, orgId));
}

stripeWebhookRouter.post("/", async (c) => {
  const sig = c.req.header("stripe-signature");
  if (!sig) {
    logger.error("Stripe webhook: missing stripe-signature header");
    return c.json({ error: "missing_signature" }, 400);
  }

  // Read raw bytes (avoid UTF-8 decode roundtrip that can break HMAC match)
  const rawBody = new Uint8Array(await c.req.arrayBuffer());

  let event: StripeEvent;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      rawBody,
      sig,
      getWebhookSecret(),
    );
  } catch (err) {
    logger.error(
      { err, bodyLen: rawBody.byteLength, sigPrefix: sig.slice(0, 32) },
      "Stripe webhook: signature verification failed",
    );
    return c.json({ error: "invalid_signature", detail: String(err) }, 400);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const orgId = await findOrgId(session.metadata, session.customer);
        if (!orgId) {
          logger.error({ sessionId: session.id }, "checkout.session.completed: no orgId");
          break;
        }
        if (!session.subscription) break;
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;
        const sub = await getStripe().subscriptions.retrieve(subId);
        await applyPlanFromSubscription(orgId, sub);
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object;
        const orgId = await findOrgId(sub.metadata, sub.customer);
        if (!orgId) {
          logger.error({ type: event.type, subId: sub.id }, "subscription event: no orgId");
          break;
        }
        await applyPlanFromSubscription(orgId, sub);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const orgId = await findOrgId(sub.metadata, sub.customer);
        if (!orgId) {
          logger.error({ subId: sub.id }, "customer.subscription.deleted: no orgId");
          break;
        }
        await db
          .update(organizations)
          .set({
            plan: "free",
            planPeriod: null,
            stripeSubscriptionId: null,
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, orgId));
        break;
      }
    }
  } catch (err) {
    logger.error({ err, type: event.type }, "Stripe webhook handler failed");
    return c.json({ error: "handler_failed" }, 500);
  }

  return c.json({ received: true });
});
