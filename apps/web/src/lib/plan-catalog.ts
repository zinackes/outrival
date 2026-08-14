import { PLAN_PRICING, type BillingPeriod, type Plan } from "@outrival/shared";

/**
 * The plan cards, once. Two surfaces sell the same four plans — the landing
 * pricing section (also served at `/pricing`) and the billing settings page — and
 * they used to carry two hand-maintained copies of this table with a "keep the
 * two in sync" comment on top. They had already drifted: billing still advertised
 * "Multi-user · API access" on Business and omitted outbound webhooks on Pro,
 * while the landing had been corrected (`features.api` and `features.multiUser`
 * are false on every plan in PLAN_LIMITS, and /docs says there are no endpoints
 * or keys today). This module is the one table both read; the landing's corrected
 * copy is what it carries.
 *
 * Prices are never written here — they derive from PLAN_PRICING in
 * `@outrival/shared`, the same table the checkout and the API gate read.
 */
export interface PlanCard {
  /** One-line pitch under the price. */
  desc: string;
  /** "Everything in <prev>, plus:" — makes each tier read as additive. Free has none. */
  includes?: string;
  features: string[];
  /** Gets the "Most popular" badge and the accent border. Exactly one plan. */
  featured: boolean;
  /** Landing CTA label. Billing derives its own button from the current plan. */
  cta: string;
  /** Landing-only secondary link under the CTA. */
  note?: { label: string; href: string };
}

export const PLAN_CARDS: Record<Plan, PlanCard> = {
  free: {
    desc: "Validate the tool on 2 competitors before bringing in your team.",
    features: [
      "2 competitors",
      "Weekly email digest",
      "Homepage · pricing · blog",
      "1 user",
    ],
    featured: false,
    cta: "Start free",
  },
  starter: {
    desc: "For solo operators who need daily scans and Slack delivery.",
    includes: "Everything in Free, plus:",
    features: [
      "5 competitors",
      "Daily scans · Slack & email digests",
      "Adds jobs + status page",
    ],
    featured: false,
    cta: "Get started",
  },
  pro: {
    desc: "For product, growth, or strategy teams that need the full signal stream.",
    includes: "Everything in Starter, plus:",
    features: [
      "15 competitors",
      "Real-time Slack/email alerts",
      // Shipped and gated here (PLAN_LIMITS.allowedChannels), but it was listed
      // nowhere a buyer looks. The public API is NOT on this page: features.api
      // is false on every plan and /docs says there are no endpoints or keys
      // today — selling it would break one click away.
      "Outbound webhooks",
      "AI-generated battle cards",
      "Trustpilot & App Store reviews",
    ],
    featured: true,
    cta: "Get started",
  },
  business: {
    desc: "50 competitors, the highest usage limits, and priority support.",
    includes: "Everything in Pro, plus:",
    features: [
      "50 competitors",
      "Higher re-scan & discovery limits",
      "Priority monitoring cadence",
      "DPA · security review",
    ],
    featured: false,
    cta: "Start Business",
    note: {
      label: "Need SSO or a custom DPA? Contact us",
      href: "mailto:hello@outrival.app",
    },
  },
};

export interface PlanPrice {
  /** Headline number, always expressed per month. */
  perMonth: number;
  /** What the invoice says — equals perMonth on monthly, the yearly total on yearly. */
  total: number;
}

/**
 * Price for a plan on a billing period, in euros. Free is 0 on both periods; it
 * carries no PLAN_PRICING row because there is nothing to charge.
 */
export function planPrice(plan: Plan, period: BillingPeriod): PlanPrice {
  if (plan === "free") return { perMonth: 0, total: 0 };
  const total = PLAN_PRICING[plan][period];
  return { perMonth: period === "yearly" ? Math.round(total / 12) : total, total };
}
