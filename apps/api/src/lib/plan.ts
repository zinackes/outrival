import { and, eq, gte, isNull, ne, count } from "drizzle-orm";
import { competitors, organizations, battleCards, discoveryRuns, forcedRescanLog, products } from "@outrival/db";
import {
  PLAN_LIMITS,
  PLANS,
  isWithinLimit,
  productLimit,
  forcedRescansPerDay,
  type Plan,
  type PlanFeature,
  type AlertChannel,
  type SourceType,
  type MonitorFrequency,
} from "@outrival/shared";
import { db } from "./db";

export function getPlanLimits(plan: Plan) {
  return PLAN_LIMITS[plan];
}

export async function getOrgPlan(orgId: string): Promise<Plan> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { plan: true },
  });
  return org?.plan ?? "free";
}

export async function countActiveCompetitors(orgId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(competitors)
    // The self-competitor (the user's own product) never counts against the quota.
    .where(
      and(
        eq(competitors.orgId, orgId),
        isNull(competitors.deletedAt),
        ne(competitors.type, "self"),
      ),
    );
  return row?.value ?? 0;
}

export interface CompetitorQuota {
  allowed: boolean;
  used: number;
  limit: number;
}

export async function checkCompetitorQuota(
  orgId: string,
  plan: Plan,
  adding = 1,
): Promise<CompetitorQuota> {
  const limit = PLAN_LIMITS[plan].maxCompetitors;
  const used = await countActiveCompetitors(orgId);
  return { allowed: used + adding <= limit, used, limit };
}

export function isFeatureAllowed(plan: Plan, feature: PlanFeature): boolean {
  return PLAN_LIMITS[plan].features[feature];
}

export function isSourceAllowed(plan: Plan, source: SourceType): boolean {
  return PLAN_LIMITS[plan].allowedSources.includes(source);
}

export function isChannelAllowed(plan: Plan, channel: AlertChannel): boolean {
  return PLAN_LIMITS[plan].allowedChannels.includes(channel);
}

export function isFrequencyAllowed(plan: Plan, freq: MonitorFrequency): boolean {
  return PLAN_LIMITS[plan].allowedFrequencies.includes(freq);
}

// ---- Per-tier volume limits (tier-limits, 2026-06-04) ------------------------
// Source of truth = PLAN_LIMITS. Competitors stay on checkCompetitorQuota, forced
// re-scans on monitors.ts (both already structured); this covers the new
// period-based caps. See docs/tier-limits.md.

export type LimitDimension = "battleCardsPerDay" | "discoveriesPerMonth";

export interface LimitCheck {
  ok: boolean;
  dimension: LimitDimension;
  used: number;
  limit: number;
  plan: Plan;
}

function utcDayStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Calendar-month key "YYYY-MM" (UTC) — the discovery quota window. */
export function currentMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dimensionLimit(plan: Plan, dimension: LimitDimension): number {
  return dimension === "battleCardsPerDay"
    ? PLAN_LIMITS[plan].battleCardsPerDay
    : PLAN_LIMITS[plan].discoveriesPerMonth;
}

async function dimensionUsage(orgId: string, dimension: LimitDimension): Promise<number> {
  if (dimension === "battleCardsPerDay") {
    // Distinct cards generated/refreshed today (cards upsert per product×competitor).
    const [row] = await db
      .select({ value: count() })
      .from(battleCards)
      .where(and(eq(battleCards.orgId, orgId), gte(battleCards.generatedAt, utcDayStart())));
    return row?.value ?? 0;
  }
  const run = await db.query.discoveryRuns.findFirst({ where: eq(discoveryRuns.orgId, orgId) });
  // The single discovery_runs row carries the calendar-month counter; a stale month
  // means the quota has rolled over (the next /detect resets it).
  if (!run || run.detectCountMonth !== currentMonthKey()) return 0;
  return run.detectCount;
}

/**
 * Whether the org is still under its per-tier cap for `dimension`. Read-only:
 * callers reject with tierLimitBody(check) when `!ok`, then perform the action.
 */
export async function assertWithinLimit(
  orgId: string,
  dimension: LimitDimension,
  opts?: { plan?: Plan; adding?: number },
): Promise<LimitCheck> {
  const plan = opts?.plan ?? (await getOrgPlan(orgId));
  const limit = dimensionLimit(plan, dimension);
  const used = await dimensionUsage(orgId, dimension);
  return { ok: isWithinLimit(used, limit, opts?.adding ?? 1), used, limit, plan, dimension };
}

const LIMIT_ERROR_CODES: Record<LimitDimension, string> = {
  battleCardsPerDay: "battlecard_limit_reached",
  discoveriesPerMonth: "discovery_limit_reached",
};

/** Cheapest plan whose `dimension` cap clears `target` — drives the upgrade prompt. */
function suggestedPlanFor(dimension: LimitDimension, target: number): Plan {
  return PLANS.find((p) => dimensionLimit(p, dimension) >= target) ?? "business";
}

/**
 * Structured limit-reached body (code + dimension + tier + limit) — never a 500.
 * The web turns `error`/`suggestedPlan` into a contextual upgrade prompt.
 */
export function tierLimitBody(check: LimitCheck) {
  return {
    error: LIMIT_ERROR_CODES[check.dimension],
    dimension: check.dimension,
    used: check.used,
    limit: check.limit,
    plan: check.plan,
    suggestedPlan: suggestedPlanFor(check.dimension, check.used + 1),
    upgradeHint: check.plan !== "business",
  };
}

// ---- Usage snapshot (consumption cockpit, Phase A) ---------------------------
// Read-only aggregate of every quantified per-tier cap, for the usage page. Pure
// reads against existing tables — no new schema. Mirrors the dimensions enforced
// across plan.ts / monitors.ts / products.ts so the page can never drift from the
// gates. See docs/consumption-cockpit.md.

export type UsageDimension =
  | "competitors"
  | "products"
  | "battleCardsPerDay"
  | "discoveriesPerMonth"
  | "forcedRescansPerDay";

export interface UsageItem {
  dimension: UsageDimension;
  used: number;
  limit: number;
  period: "current" | "day" | "month";
  // Cheapest plan whose cap clears current use, or null when the current plan
  // already does (drives the contextual upgrade prompt).
  suggestedPlan: Plan | null;
}

export interface UsageSnapshot {
  plan: Plan;
  items: UsageItem[];
}

function usageLimit(plan: Plan, dimension: UsageDimension): number {
  switch (dimension) {
    case "competitors":
      return PLAN_LIMITS[plan].maxCompetitors;
    case "products":
      return productLimit(plan);
    case "battleCardsPerDay":
      return PLAN_LIMITS[plan].battleCardsPerDay;
    case "discoveriesPerMonth":
      return PLAN_LIMITS[plan].discoveriesPerMonth;
    case "forcedRescansPerDay":
      return forcedRescansPerDay(plan);
  }
}

const USAGE_PERIOD: Record<UsageDimension, UsageItem["period"]> = {
  competitors: "current",
  products: "current",
  battleCardsPerDay: "day",
  discoveriesPerMonth: "month",
  forcedRescansPerDay: "day",
};

/** Cheapest plan whose `dimension` cap clears `used`, or null if the current plan already does. */
function suggestPlanForUsage(plan: Plan, dimension: UsageDimension, used: number): Plan | null {
  if (used < usageLimit(plan, dimension)) return null;
  const next = PLANS.find((p) => usageLimit(p, dimension) > used);
  return next && next !== plan ? next : null;
}

async function countActiveProducts(orgId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(products)
    .where(and(eq(products.orgId, orgId), ne(products.status, "archived")));
  return row?.value ?? 0;
}

async function countForcedRescansToday(orgId: string): Promise<number> {
  // Org-level total today. The cap is per-user/day; with multi-user off this is
  // 1:1, and the page labels it as the per-user daily cap.
  const [row] = await db
    .select({ value: count() })
    .from(forcedRescanLog)
    .where(and(eq(forcedRescanLog.orgId, orgId), gte(forcedRescanLog.triggeredAt, utcDayStart())));
  return row?.value ?? 0;
}

/** Every quantified per-tier cap with current use — read-only, no new schema. */
export async function getUsageSnapshot(orgId: string): Promise<UsageSnapshot> {
  const plan = await getOrgPlan(orgId);
  const [competitorsUsed, productsUsed, cardsUsed, discoveriesUsed, rescansUsed] =
    await Promise.all([
      countActiveCompetitors(orgId),
      countActiveProducts(orgId),
      dimensionUsage(orgId, "battleCardsPerDay"),
      dimensionUsage(orgId, "discoveriesPerMonth"),
      countForcedRescansToday(orgId),
    ]);

  const used: Record<UsageDimension, number> = {
    competitors: competitorsUsed,
    products: productsUsed,
    battleCardsPerDay: cardsUsed,
    discoveriesPerMonth: discoveriesUsed,
    forcedRescansPerDay: rescansUsed,
  };

  const items: UsageItem[] = (Object.keys(used) as UsageDimension[]).map((dimension) => ({
    dimension,
    used: used[dimension],
    limit: usageLimit(plan, dimension),
    period: USAGE_PERIOD[dimension],
    suggestedPlan: suggestPlanForUsage(plan, dimension, used[dimension]),
  }));

  return { plan, items };
}
