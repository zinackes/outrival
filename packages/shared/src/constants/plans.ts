import type { SourceType, MonitorFrequency } from "./sources";

export const PLANS = ["free", "starter", "pro", "business"] as const;
export type Plan = typeof PLANS[number];

export const ALERT_CHANNELS = ["email", "slack", "webhook"] as const;
export type AlertChannel = typeof ALERT_CHANNELS[number];

export const BILLING_PERIODS = ["monthly", "yearly"] as const;
export type BillingPeriod = typeof BILLING_PERIODS[number];

export interface PlanLimits {
  maxCompetitors: number;
  allowedFrequencies: MonitorFrequency[];
  allowedChannels: AlertChannel[];
  allowedSources: SourceType[];
  features: {
    battleCards: boolean;
    realtimeAlerts: boolean;
    api: boolean;
    multiUser: boolean;
  };
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    maxCompetitors: 2,
    allowedFrequencies: ["weekly"],
    allowedChannels: ["email"],
    allowedSources: ["homepage", "pricing", "blog"],
    features: { battleCards: false, realtimeAlerts: false, api: false, multiUser: false },
  },
  starter: {
    maxCompetitors: 5,
    allowedFrequencies: ["daily", "weekly"],
    allowedChannels: ["email", "slack"],
    allowedSources: ["homepage", "pricing", "blog", "jobs"],
    features: { battleCards: false, realtimeAlerts: false, api: false, multiUser: false },
  },
  pro: {
    maxCompetitors: 15,
    allowedFrequencies: ["realtime", "daily", "weekly"],
    allowedChannels: ["email", "slack", "webhook"],
    allowedSources: ["homepage", "pricing", "blog", "jobs", "g2_reviews", "capterra_reviews"],
    features: { battleCards: true, realtimeAlerts: true, api: false, multiUser: false },
  },
  business: {
    maxCompetitors: Number.POSITIVE_INFINITY,
    allowedFrequencies: ["realtime", "daily", "weekly"],
    allowedChannels: ["email", "slack", "webhook"],
    allowedSources: [
      "homepage", "pricing", "blog", "jobs",
      "g2_reviews", "capterra_reviews", "appstore_reviews",
    ],
    features: { battleCards: true, realtimeAlerts: true, api: true, multiUser: true },
  },
};

export type PlanFeature = keyof PlanLimits["features"];

export const PLAN_PRICING = {
  starter: { monthly: 29, yearly: 290 },
  pro: { monthly: 79, yearly: 790 },
  business: { monthly: 199, yearly: 1990 },
} as const satisfies Record<Exclude<Plan, "free">, Record<BillingPeriod, number>>;

export const PLAN_LABELS: Record<Plan, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  business: "Business",
};

/** Whether `plan` is entitled to monitor `source`. Mirrors the API source gate. */
export function planIncludesSource(plan: Plan, source: SourceType): boolean {
  return PLAN_LIMITS[plan].allowedSources.includes(source);
}

/** Cheapest plan whose allowed sources include `source` — drives badges/upsell copy. */
export function minPlanForSource(source: SourceType): Plan {
  return PLANS.find((p) => PLAN_LIMITS[p].allowedSources.includes(source)) ?? "business";
}

/** Whether `plan` may scrape at `freq`. Mirrors the API frequency gate. */
export function planIncludesFrequency(plan: Plan, freq: MonitorFrequency): boolean {
  return PLAN_LIMITS[plan].allowedFrequencies.includes(freq);
}

/** Cheapest plan whose allowed frequencies include `freq` — drives badges/upsell copy. */
export function minPlanForFrequency(freq: MonitorFrequency): Plan {
  return PLANS.find((p) => PLAN_LIMITS[p].allowedFrequencies.includes(freq)) ?? "business";
}

/** Cheapest plan that unlocks `feature` — drives badges/upsell copy. */
export function minPlanForFeature(feature: PlanFeature): Plan {
  return PLANS.find((p) => PLAN_LIMITS[p].features[feature]) ?? "business";
}

/** patch-28 — default max active products (SKUs) per org by plan. */
const PRODUCT_LIMIT_DEFAULTS: Record<Plan, number> = {
  free: 1,
  starter: 2,
  pro: 5,
  business: 999,
};

/**
 * Max active products (SKUs) an org on `plan` may have. Env-configurable
 * (PRODUCT_LIMIT_FREE/STARTER/PRO/BUSINESS) with the defaults above. Read
 * server-side for gating; on the client `process.env` is undefined so it falls
 * back to the same defaults, and the API echoes the authoritative limit in
 * `product_limit_reached` errors / the products endpoint.
 */
export function productLimit(plan: Plan): number {
  const raw = {
    free: process.env.PRODUCT_LIMIT_FREE,
    starter: process.env.PRODUCT_LIMIT_STARTER,
    pro: process.env.PRODUCT_LIMIT_PRO,
    business: process.env.PRODUCT_LIMIT_BUSINESS,
  }[plan];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : PRODUCT_LIMIT_DEFAULTS[plan];
}

/** Cheapest plan whose product limit is ≥ `count` — drives upgrade hints. */
export function minPlanForProductCount(count: number): Plan {
  return PLANS.find((p) => productLimit(p) >= count) ?? "business";
}
