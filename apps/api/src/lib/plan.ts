import { and, eq, isNull, count } from "drizzle-orm";
import { competitors, organizations } from "@outrival/db";
import {
  PLAN_LIMITS,
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
    .where(and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)));
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
