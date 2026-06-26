import type { SourceType, MonitorFrequency } from "./sources";

export const PLANS = ["free", "starter", "pro", "business"] as const;
export type Plan = typeof PLANS[number];

export const ALERT_CHANNELS = ["email", "slack", "webhook"] as const;
export type AlertChannel = typeof ALERT_CHANNELS[number];

export const BILLING_PERIODS = ["monthly", "yearly"] as const;
export type BillingPeriod = typeof BILLING_PERIODS[number];

// A tier is a plan — Plan IS the tier axis (free/starter/pro/business). PLAN_LIMITS
// below is the single source of truth for every per-tier limit; alias the vocabulary
// so callers can say "tier" without a second, divergent table.
export type Tier = Plan;

// Per-tier scrape cadence (decided 2026-06-04, "Repenser limites par tier").
// `weekly`/`daily` map onto the real reschedule; `daily_adaptive` is the existing
// staleness multiplier (computeNextRun), `daily_priority` is a future queue-priority
// label (no distinct runtime behaviour yet — see docs/tier-limits.md).
export const SCRAPE_FREQUENCY_TIERS = ["weekly", "daily", "daily_adaptive", "daily_priority"] as const;
export type ScrapeFrequencyTier = typeof SCRAPE_FREQUENCY_TIERS[number];

export interface PlanLimits {
  maxCompetitors: number;
  allowedFrequencies: MonitorFrequency[];
  allowedChannels: AlertChannel[];
  allowedSources: SourceType[];
  // Canonical per-tier cadence shown to users. The frequency *gate* still rides on
  // allowedFrequencies; this is the headline label + the free→weekly cap.
  scrapeFrequency: ScrapeFrequencyTier;
  // Per-tier volume caps (enforced via assertWithinLimit in apps/api/src/lib/plan.ts).
  forcedRescansPerDay: number;
  battleCardsPerDay: number;
  discoveriesPerMonth: number;
  // Source-of-truth values whose enforcement is deferred (see docs/tier-limits.md):
  // usersPerOrg → at invitation (Phase 10 multi-user), historyRetentionDays → purge job.
  usersPerOrg: number;
  historyRetentionDays: number;
  features: {
    battleCards: boolean;
    realtimeAlerts: boolean;
    api: boolean;
    multiUser: boolean;
    // Full onboarding (vs Quick Start) — gate deferred (TODO, see docs/tier-limits.md).
    fullMode: boolean;
    // CRM integrations — backlog feature; flag carried so the source of truth is complete.
    crmIntegrations: boolean;
  };
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    maxCompetitors: 2,
    allowedFrequencies: ["weekly"],
    allowedChannels: ["email"],
    allowedSources: ["homepage", "pricing", "blog"],
    scrapeFrequency: "weekly",
    forcedRescansPerDay: 1,
    battleCardsPerDay: 1,
    discoveriesPerMonth: 3,
    usersPerOrg: 1,
    historyRetentionDays: 7,
    // Battle cards now open to every tier, governed by battleCardsPerDay (not a hard gate).
    features: { battleCards: true, realtimeAlerts: false, api: false, multiUser: false, fullMode: false, crmIntegrations: false },
  },
  starter: {
    maxCompetitors: 5,
    allowedFrequencies: ["daily", "weekly"],
    allowedChannels: ["email", "slack"],
    allowedSources: ["homepage", "pricing", "blog", "jobs", "status"],
    scrapeFrequency: "daily",
    forcedRescansPerDay: 5,
    battleCardsPerDay: 10,
    discoveriesPerMonth: 20,
    usersPerOrg: 1,
    historyRetentionDays: 30,
    features: { battleCards: true, realtimeAlerts: false, api: false, multiUser: false, fullMode: true, crmIntegrations: false },
  },
  pro: {
    maxCompetitors: 15,
    allowedFrequencies: ["realtime", "daily", "weekly"],
    allowedChannels: ["email", "slack", "webhook"],
    allowedSources: ["homepage", "pricing", "blog", "jobs", "g2_reviews", "capterra_reviews", "trustpilot_reviews", "trustradius_reviews", "reddit", "status"],
    scrapeFrequency: "daily_adaptive",
    forcedRescansPerDay: 20,
    battleCardsPerDay: 50,
    discoveriesPerMonth: 100,
    usersPerOrg: 3,
    historyRetentionDays: 365,
    features: { battleCards: true, realtimeAlerts: true, api: false, multiUser: false, fullMode: true, crmIntegrations: false },
  },
  business: {
    // Decided 2026-06-04: a real, displayed cap — no "unlimited" anywhere.
    maxCompetitors: 50,
    allowedFrequencies: ["realtime", "daily", "weekly"],
    allowedChannels: ["email", "slack", "webhook"],
    allowedSources: [
      "homepage", "pricing", "blog", "jobs",
      "g2_reviews", "capterra_reviews", "appstore_reviews", "status",
      "trustpilot_reviews", "trustradius_reviews", "gartner_reviews", "playstore_reviews",
      "reddit",
    ],
    scrapeFrequency: "daily_priority",
    // Anti-abuse ceilings, far above normal use; a fair-use clause (TOS) covers the
    // extremes. TODO(tier-limits): wire a throttling/fair-use guard for these caps.
    forcedRescansPerDay: 100,
    battleCardsPerDay: 100,
    discoveriesPerMonth: 500,
    usersPerOrg: 10,
    historyRetentionDays: 1095,
    features: { battleCards: true, realtimeAlerts: true, api: true, multiUser: true, fullMode: true, crmIntegrations: true },
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

/**
 * Whether `source` is governed by plan gating at all — i.e. it appears in some
 * plan's allowedSources. Internal anchors (tech_stack/sitemap/news) and not-yet-
 * tiered sources (changelog/linkedin/twitter/github_repo) appear in no plan, so
 * they are never gated and a downgrade never freezes them.
 */
export function isGatedSource(source: SourceType): boolean {
  return PLANS.some((p) => PLAN_LIMITS[p].allowedSources.includes(source));
}

/**
 * Whether a monitor on `source` may run under `plan`. Ungated sources always run;
 * gated sources only while the plan still includes them. This is what freezes a
 * downgraded org's premium sources (jobs/reviews/status) without mutating monitor
 * rows — re-upgrading restores them on the next scrape cycle.
 */
export function planAllowsMonitorSource(plan: Plan, source: SourceType): boolean {
  return !isGatedSource(source) || planIncludesSource(plan, source);
}

/** Whether `plan` may scrape at `freq`. Mirrors the API frequency gate. */
export function planIncludesFrequency(plan: Plan, freq: MonitorFrequency): boolean {
  return PLAN_LIMITS[plan].allowedFrequencies.includes(freq);
}

/** Cheapest plan whose allowed frequencies include `freq` — drives badges/upsell copy. */
export function minPlanForFrequency(freq: MonitorFrequency): Plan {
  return PLANS.find((p) => PLAN_LIMITS[p].allowedFrequencies.includes(freq)) ?? "business";
}

/**
 * Cross-competitor "Sector trends" compare patterns across an org's competitors,
 * so they only turn on once enough competitors are monitored. Single source of
 * truth for that floor — the worker job (analyze-sectoral) defaults its env to
 * this, the API reports it for the empty state, the web gates the nav on it.
 */
export const SECTORAL_MIN_COMPETITORS = 4;

/**
 * Whether `plan` can ever reach the sector-trends competitor floor. A plan whose
 * maxCompetitors is below SECTORAL_MIN_COMPETITORS (free: 2) can never populate
 * the Sector page, so we hide it / show an upsell rather than a dead empty state.
 */
export function planCanReachSectoral(plan: Plan): boolean {
  return PLAN_LIMITS[plan].maxCompetitors >= SECTORAL_MIN_COMPETITORS;
}

/** Cheapest plan that can reach the sector-trends floor — drives upsell copy. */
export function minPlanForSectoral(): Plan {
  return (
    PLANS.find((p) => PLAN_LIMITS[p].maxCompetitors >= SECTORAL_MIN_COMPETITORS) ??
    "business"
  );
}

/**
 * Clamp a monitor's requested frequency to what `plan` allows. Returned unchanged when
 * the plan already permits it, otherwise dropped to the plan's most-frequent allowed
 * cadence — `allowedFrequencies` is ordered most→least frequent, so `[0]` is the cap.
 * This is what stops a downgraded org's realtime monitors from continuing to scrape
 * realtime: the reschedule cadence falls to the tier cap without mutating the stored
 * frequency, so re-upgrading restores it on the next run.
 */
export function clampFrequencyToPlan(plan: Plan, freq: MonitorFrequency): MonitorFrequency {
  if (planIncludesFrequency(plan, freq)) return freq;
  return PLAN_LIMITS[plan].allowedFrequencies[0] ?? "weekly";
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

/**
 * Daily cap on user-forced re-scans for `plan` (patch-27). Defaults come from
 * PLAN_LIMITS (business 100, decided 2026-06-04); FORCED_RESCAN_LIMIT_FREE/STARTER/
 * PRO/BUSINESS still override server-side for back-compat. Client `process.env` is
 * undefined → falls back to the PLAN_LIMITS default.
 */
/** Boundary check shared by every limit gate: is `used + adding` still within `limit`? */
export function isWithinLimit(used: number, limit: number, adding = 1): boolean {
  return used + adding <= limit;
}

export function forcedRescansPerDay(plan: Plan): number {
  const raw = {
    free: process.env.FORCED_RESCAN_LIMIT_FREE,
    starter: process.env.FORCED_RESCAN_LIMIT_STARTER,
    pro: process.env.FORCED_RESCAN_LIMIT_PRO,
    business: process.env.FORCED_RESCAN_LIMIT_BUSINESS,
  }[plan];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : PLAN_LIMITS[plan].forcedRescansPerDay;
}
