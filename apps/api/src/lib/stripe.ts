import Stripe from "stripe";
import type { BillingPeriod, Plan } from "@outrival/shared";

export type StripeClient = InstanceType<typeof Stripe>;

let cached: StripeClient | null = null;

export function getStripe(): StripeClient {
  if (cached) return cached;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY is not set");
  cached = new Stripe(secret, { apiVersion: "2026-04-22.dahlia" });
  return cached;
}

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  return secret;
}

type PaidPlan = Exclude<Plan, "free">;

const PRICE_ENV_KEYS: Record<PaidPlan, Record<BillingPeriod, string>> = {
  starter: {
    monthly: "STRIPE_PRICE_STARTER_MONTHLY",
    yearly: "STRIPE_PRICE_STARTER_YEARLY",
  },
  pro: {
    monthly: "STRIPE_PRICE_PRO_MONTHLY",
    yearly: "STRIPE_PRICE_PRO_YEARLY",
  },
  business: {
    monthly: "STRIPE_PRICE_BUSINESS_MONTHLY",
    yearly: "STRIPE_PRICE_BUSINESS_YEARLY",
  },
};

export function getPriceId(plan: PaidPlan, period: BillingPeriod): string {
  const envKey = PRICE_ENV_KEYS[plan][period];
  const value = process.env[envKey];
  if (!value) throw new Error(`Missing env ${envKey} for ${plan} ${period}`);
  return value;
}

export function lookupPlanByPriceId(
  priceId: string,
): { plan: PaidPlan; period: BillingPeriod } | null {
  for (const plan of ["starter", "pro", "business"] as const) {
    for (const period of ["monthly", "yearly"] as const) {
      if (process.env[PRICE_ENV_KEYS[plan][period]] === priceId) {
        return { plan, period };
      }
    }
  }
  return null;
}
