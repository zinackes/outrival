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
