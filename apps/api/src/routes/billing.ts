import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { organizations, users } from "@outrival/db";
import { BILLING_PERIODS, PLAN_LIMITS, PLANS, type Plan } from "@outrival/shared";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { countActiveCompetitors, pausedByPlanCap } from "../lib/plan";
import { getPriceId, getStripe } from "../lib/stripe";
import { captureServerEvent } from "../lib/posthog";

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

  // Which competitors the plan cap actually froze — the notice names them so the
  // user isn't left guessing. Only queried when over cap (empty otherwise).
  const paused =
    Number.isFinite(limit) && used > limit
      ? await pausedByPlanCap(orgId, org.plan)
      : [];

  // Pending downgrade-to-free state: when the user cancels, Stripe keeps the sub
  // `active` with cancel_at_period_end=true until the cycle ends (then fires
  // subscription.deleted → free). Read it live (best-effort) so the dashboard can
  // show "cancels on <date>" + a Resume affordance without a schema column.
  let cancelAtPeriodEnd = false;
  let cancelAt: number | null = null;
  if (org.stripeSubscriptionId) {
    try {
      const sub = await getStripe().subscriptions.retrieve(org.stripeSubscriptionId);
      cancelAtPeriodEnd = sub.cancel_at_period_end === true;
      cancelAt = sub.cancel_at ? sub.cancel_at * 1000 : null;
    } catch {
      // Stripe hiccup → treat as no pending cancellation; never block the page.
    }
  }

  // The card on file (default payment method) so the page can show "Visa •••• 4242"
  // and drive an in-app update instead of bouncing to the hosted portal. Best-effort:
  // a Stripe hiccup just hides the card line, never blocks the page.
  let paymentMethod: {
    brand: string | null;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
  } | null = null;
  if (org.stripeCustomerId) {
    try {
      const customer = await getStripe().customers.retrieve(org.stripeCustomerId, {
        expand: ["invoice_settings.default_payment_method"],
      });
      if (!("deleted" in customer)) {
        const pm = customer.invoice_settings?.default_payment_method;
        const card = pm && typeof pm !== "string" ? pm.card : null;
        if (card) {
          paymentMethod = {
            brand: card.brand ?? null,
            last4: card.last4 ?? null,
            expMonth: card.exp_month ?? null,
            expYear: card.exp_year ?? null,
          };
        }
      }
    } catch {
      // Card display is a nicety — ignore and render the page without it.
    }
  }

  return c.json({
    plan: org.plan,
    planPeriod: org.planPeriod,
    hasSubscription: Boolean(org.stripeSubscriptionId),
    cancelAtPeriodEnd,
    cancelAt,
    paymentMethod,
    usage: {
      competitors: {
        used,
        limit: Number.isFinite(limit) ? limit : null,
        paused,
      },
    },
    features: limits.features,
  });
});

// Recent invoices for in-app billing visibility (receipts without bouncing to the
// Stripe portal). Best-effort: a Stripe hiccup returns an empty list, never errors.
billingRouter.get("/invoices", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return c.json({ error: "Not found" }, 404);
  if (!org.stripeCustomerId) return c.json({ invoices: [] });

  try {
    const list = await getStripe().invoices.list({
      customer: org.stripeCustomerId,
      limit: 6,
    });
    return c.json({
      invoices: list.data.map((inv) => ({
        id: inv.id,
        number: inv.number,
        date: inv.created * 1000,
        amountPaid: inv.amount_paid,
        currency: inv.currency,
        status: inv.status,
        hostedUrl: inv.hosted_invoice_url,
        pdfUrl: inv.invoice_pdf,
      })),
    });
  } catch {
    return c.json({ invoices: [] });
  }
});

// Single entry point for moving onto / between paid plans. With no active sub the
// first paid plan goes through Checkout (collects a payment method, handles SCA);
// with one already in place we switch the item price IN PLACE (prorated) instead of
// opening a second checkout — the old flow created a duplicate, untracked
// subscription that kept billing after the webhook overwrote stripeSubscriptionId.
billingRouter.post("/change-plan", async (c) => {
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

  let priceId: string;
  try {
    priceId = getPriceId(parsed.data.plan, parsed.data.period);
  } catch (e) {
    return c.json({ error: "price_not_configured", detail: String(e) }, 500);
  }

  // In-place switch when a reusable subscription exists (a canceled/expired one is
  // not updatable → fall through to a fresh checkout). The webhook re-maps the plan
  // from the new price on customer.subscription.updated.
  if (org.stripeSubscriptionId) {
    const sub = await stripe.subscriptions.retrieve(org.stripeSubscriptionId);
    const reusable =
      sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";
    const itemId = sub.items.data[0]?.id;
    if (reusable && itemId) {
      await stripe.subscriptions.update(org.stripeSubscriptionId, {
        items: [{ id: itemId, price: priceId }],
        proration_behavior: "create_prorations",
        // A plan change also clears any scheduled downgrade-to-free.
        cancel_at_period_end: false,
        metadata: { orgId, plan: parsed.data.plan, period: parsed.data.period },
      });
      void captureServerEvent(userId, "plan_changed", {
        plan: parsed.data.plan,
        period: parsed.data.period,
        orgId,
      });
      return c.json({ updated: true });
    }
  }

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

  void captureServerEvent(userId, "checkout_initiated", {
    plan: parsed.data.plan,
    period: parsed.data.period,
    orgId,
  });

  return c.json({ url: session.url });
});

// Downgrade to Free = schedule cancellation at period end (the FAQ promise: one
// click, keep access until the cycle ends). subscription.deleted then drops the org
// to free. The over-limit competitors aren't touched — schedule-scraping freezes the
// excess non-destructively and restores them on re-upgrade.
billingRouter.post("/downgrade", async (c) => {
  const userId = c.get("user").id;
  const orgId = await ensureUserOrg(userId);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return c.json({ error: "Not found" }, 404);
  if (!org.stripeSubscriptionId) {
    return c.json({ error: "no_subscription" }, 400);
  }

  const sub = await getStripe().subscriptions.update(org.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  void captureServerEvent(userId, "plan_downgrade_scheduled", { orgId });

  return c.json({ ok: true, cancelAt: sub.cancel_at ? sub.cancel_at * 1000 : null });
});

// Undo a scheduled downgrade-to-free before it takes effect.
billingRouter.post("/resume", async (c) => {
  const userId = c.get("user").id;
  const orgId = await ensureUserOrg(userId);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return c.json({ error: "Not found" }, 404);
  if (!org.stripeSubscriptionId) {
    return c.json({ error: "no_subscription" }, 400);
  }

  await getStripe().subscriptions.update(org.stripeSubscriptionId, {
    cancel_at_period_end: false,
  });

  void captureServerEvent(userId, "plan_downgrade_cancelled", { orgId });

  return c.json({ ok: true });
});

// In-app payment-method update — replaces the hosted portal for the one thing it was
// still used for. Two steps: (1) mint a SetupIntent the Payment Element confirms
// client-side, so card data goes straight to Stripe and never touches our server
// (keeps us SAQ A); (2) the client hands the resulting payment method back to
// /payment-method, which pins it as the customer + subscription default.
billingRouter.post("/setup-intent", async (c) => {
  const userId = c.get("user").id;
  const orgId = await ensureUserOrg(userId);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return c.json({ error: "Not found" }, 404);
  if (!org.stripeCustomerId) return c.json({ error: "no_subscription" }, 400);

  const setupIntent = await getStripe().setupIntents.create({
    customer: org.stripeCustomerId,
    payment_method_types: ["card"],
    usage: "off_session",
    metadata: { orgId },
  });

  if (!setupIntent.client_secret) return c.json({ error: "no_client_secret" }, 500);
  return c.json({ clientSecret: setupIntent.client_secret });
});

const PaymentMethodSchema = z.object({ paymentMethodId: z.string().min(1) });

billingRouter.post("/payment-method", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = PaymentMethodSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body" }, 400);

  const userId = c.get("user").id;
  const orgId = await ensureUserOrg(userId);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return c.json({ error: "Not found" }, 404);
  if (!org.stripeCustomerId) return c.json({ error: "no_subscription" }, 400);

  const stripe = getStripe();
  const { paymentMethodId } = parsed.data;

  // The SetupIntent already attached the PM to this customer; Stripe rejects a PM
  // that isn't attached, so a forged/cross-tenant id can't be set here. Pin it as the
  // default on the customer (drives future invoices) and on the subscription (avoids
  // relying on the customer-default fallback resolution).
  await stripe.customers.update(org.stripeCustomerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
  if (org.stripeSubscriptionId) {
    try {
      await stripe.subscriptions.update(org.stripeSubscriptionId, {
        default_payment_method: paymentMethodId,
      });
    } catch {
      // A canceled/expired sub can't be updated — the customer default still applies.
    }
  }

  void captureServerEvent(userId, "payment_method_updated", { orgId });

  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  return c.json({
    ok: true,
    card: pm.card
      ? {
          brand: pm.card.brand ?? null,
          last4: pm.card.last4 ?? null,
          expMonth: pm.card.exp_month ?? null,
          expYear: pm.card.exp_year ?? null,
        }
      : null,
  });
});
