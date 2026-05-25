import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { organizations, users } from "@outrival/db";
import { BILLING_PERIODS, PLAN_LIMITS, PLANS, type Plan } from "@outrival/shared";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { countActiveCompetitors } from "../lib/plan";
import { getPriceId, getStripe } from "../lib/stripe";

type Variables = { user: { id: string } };

export const billingRouter = new Hono<{ Variables: Variables }>();

billingRouter.use("*", authMiddleware);

const PAID_PLANS = PLANS.filter((p): p is Exclude<Plan, "free"> => p !== "free");

const CheckoutSchema = z.object({
  plan: z.enum(PAID_PLANS as [Exclude<Plan, "free">, ...Exclude<Plan, "free">[]]),
  period: z.enum(BILLING_PERIODS),
});

function webBaseUrl(): string {
  return process.env.WEB_URL ?? "http://localhost:3000";
}

billingRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return c.json({ error: "Not found" }, 404);

  const used = await countActiveCompetitors(orgId);
  const limits = PLAN_LIMITS[org.plan];
  const limit = limits.maxCompetitors;

  return c.json({
    plan: org.plan,
    planPeriod: org.planPeriod,
    hasSubscription: Boolean(org.stripeSubscriptionId),
    usage: {
      competitors: {
        used,
        limit: Number.isFinite(limit) ? limit : null,
      },
    },
    features: limits.features,
  });
});

billingRouter.post("/checkout", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  const userId = c.get("user").id;
  const orgId = await ensureUserOrg(userId);

  const [org, dbUser] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(organizations.id, orgId) }),
    db.query.users.findFirst({ where: eq(users.id, userId) }),
  ]);
  if (!org || !dbUser) return c.json({ error: "Not found" }, 404);

  const stripe = getStripe();

  let customerId = org.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: dbUser.email,
      name: org.name,
      metadata: { orgId },
    });
    customerId = customer.id;
    await db
      .update(organizations)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(organizations.id, orgId));
  }

  let priceId: string;
  try {
    priceId = getPriceId(parsed.data.plan, parsed.data.period);
  } catch (e) {
    return c.json({ error: "price_not_configured", detail: String(e) }, 500);
  }

  const base = webBaseUrl();
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

  if (!session.url) return c.json({ error: "no_checkout_url" }, 500);
  return c.json({ url: session.url });
});

billingRouter.post("/portal", async (c) => {
  const userId = c.get("user").id;
  const orgId = await ensureUserOrg(userId);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return c.json({ error: "Not found" }, 404);
  if (!org.stripeCustomerId) {
    return c.json({ error: "no_subscription" }, 400);
  }

  const stripe = getStripe();
  const base = webBaseUrl();
  const portal = await stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${base}/dashboard/settings/billing`,
  });

  return c.json({ url: portal.url });
});
