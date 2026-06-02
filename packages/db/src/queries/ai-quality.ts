import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../client";
import { aiQualityChecks } from "../schema";

export type ReviewResolution = "correct" | "hallucination_confirmed" | "false_positive";

// Persistence + read helpers for the anti-hallucination quality state (patch-24).
// Kept structurally typed (no @outrival/ai import) so @outrival/db stays a leaf —
// a GroundedQuality is assignable to QualityEnvelope.

export interface QualityEnvelope {
  confidence: string | null;
  citations: unknown;
  groundingValidation: { score?: number } | null | unknown;
  selfCheck: unknown;
  selfCheckTriggeredBy: string | null;
  flaggedForHumanReview: boolean;
}

export interface QualityCheckInput {
  aiTask: string;
  targetType: string;
  targetId?: string | null;
  orgId?: string | null;
  quality: QualityEnvelope;
}

/**
 * Persist one fresh AI generation's quality envelope. Best-effort: a DB hiccup
 * here must never break signal/battle-card/digest generation, so it returns null
 * instead of throwing. The flagged timestamp is set when the self-check failed.
 */
export async function insertAiQualityCheck(input: QualityCheckInput): Promise<string | null> {
  try {
    const gv = input.quality.groundingValidation as { score?: number } | null;
    const flagged = input.quality.flaggedForHumanReview;
    const [row] = await db
      .insert(aiQualityChecks)
      .values({
        aiTask: input.aiTask,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        orgId: input.orgId ?? null,
        confidence: input.quality.confidence ?? null,
        citations: input.quality.citations ?? null,
        groundingValidation: (input.quality.groundingValidation as object) ?? null,
        groundingScore: typeof gv?.score === "number" ? gv.score : null,
        selfCheckResult: (input.quality.selfCheck as object) ?? null,
        selfCheckTriggeredBy: input.quality.selfCheckTriggeredBy ?? null,
        flaggedForHumanReview: flagged,
        flaggedAt: flagged ? new Date() : null,
      })
      .returning({ id: aiQualityChecks.id });
    return row?.id ?? null;
  } catch (err) {
    console.error("insertAiQualityCheck failed (non-fatal):", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * User self-acknowledges a flagged output ("I checked, it's fine"): clears the
 * flag and records a false-positive resolution. Scoped to the user's org so a user
 * can only resolve their own workspace's outputs.
 */
export async function acknowledgeQualityChecks(
  targetType: string,
  targetId: string,
  orgId: string,
): Promise<void> {
  await db
    .update(aiQualityChecks)
    .set({
      flaggedForHumanReview: false,
      reviewResolution: "false_positive",
      reviewedAt: new Date(),
    })
    .where(
      and(
        eq(aiQualityChecks.targetType, targetType),
        eq(aiQualityChecks.targetId, targetId),
        eq(aiQualityChecks.orgId, orgId),
        eq(aiQualityChecks.flaggedForHumanReview, true),
      ),
    );
}

// --- Ops review queue + metrics (patch-24, admin only) ---

/** Flagged outputs awaiting a human verdict, newest first. */
export async function listFlaggedQualityChecks(limit = 100) {
  return db
    .select({
      id: aiQualityChecks.id,
      aiTask: aiQualityChecks.aiTask,
      targetType: aiQualityChecks.targetType,
      targetId: aiQualityChecks.targetId,
      orgId: aiQualityChecks.orgId,
      confidence: aiQualityChecks.confidence,
      citations: aiQualityChecks.citations,
      groundingValidation: aiQualityChecks.groundingValidation,
      selfCheckResult: aiQualityChecks.selfCheckResult,
      selfCheckTriggeredBy: aiQualityChecks.selfCheckTriggeredBy,
      flaggedAt: aiQualityChecks.flaggedAt,
      createdAt: aiQualityChecks.createdAt,
    })
    .from(aiQualityChecks)
    .where(eq(aiQualityChecks.flaggedForHumanReview, true))
    .orderBy(desc(aiQualityChecks.flaggedAt))
    .limit(limit);
}

/**
 * Record a human verdict on a flagged output. A confirmed hallucination keeps the
 * flag (corrective action pending); correct / false-positive clears it.
 */
export async function resolveQualityCheck(
  id: string,
  resolution: ReviewResolution,
  reviewerId: string,
): Promise<void> {
  const keepFlagged = resolution === "hallucination_confirmed";
  await db
    .update(aiQualityChecks)
    .set({
      reviewResolution: resolution,
      reviewedAt: new Date(),
      reviewedBy: reviewerId,
      flaggedForHumanReview: keepFlagged,
    })
    .where(eq(aiQualityChecks.id, id));
}

export interface QualityReviewStats {
  total: number;
  selfChecked: number;
  failed: number;
  confirmed: number;
  falsePositive: number;
  pending: number;
}

/** Aggregate counts over the last `days` for the ops dashboard header. */
export async function getQualityReviewStats(days = 30): Promise<QualityReviewStats> {
  const since = new Date(Date.now() - days * 86400_000);
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      selfChecked: sql<number>`count(*) filter (where ${aiQualityChecks.selfCheckResult} is not null)`,
      failed: sql<number>`count(*) filter (where ${aiQualityChecks.flaggedAt} is not null)`,
      confirmed: sql<number>`count(*) filter (where ${aiQualityChecks.reviewResolution} = 'hallucination_confirmed')`,
      falsePositive: sql<number>`count(*) filter (where ${aiQualityChecks.reviewResolution} = 'false_positive')`,
      pending: sql<number>`count(*) filter (where ${aiQualityChecks.flaggedForHumanReview} = true and ${aiQualityChecks.reviewResolution} is null)`,
    })
    .from(aiQualityChecks)
    .where(gte(aiQualityChecks.createdAt, since));
  return {
    total: Number(row?.total ?? 0),
    selfChecked: Number(row?.selfChecked ?? 0),
    failed: Number(row?.failed ?? 0),
    confirmed: Number(row?.confirmed ?? 0),
    falsePositive: Number(row?.falsePositive ?? 0),
    pending: Number(row?.pending ?? 0),
  };
}

export interface TaskQualityRow {
  aiTask: string;
  generations: number;
  selfChecked: number;
  failed: number;
  confirmed: number;
  /** Confirmed hallucinations over self-checks, 0-1. */
  hallucinationRate: number;
  avgGroundingScore: number | null;
}

/** Per-task quality breakdown over the last `days` (patch-24 metrics). */
export async function getQualityByTask(days = 30): Promise<TaskQualityRow[]> {
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await db
    .select({
      aiTask: aiQualityChecks.aiTask,
      generations: sql<number>`count(*)`,
      selfChecked: sql<number>`count(*) filter (where ${aiQualityChecks.selfCheckResult} is not null)`,
      failed: sql<number>`count(*) filter (where ${aiQualityChecks.flaggedAt} is not null)`,
      confirmed: sql<number>`count(*) filter (where ${aiQualityChecks.reviewResolution} = 'hallucination_confirmed')`,
      avgGroundingScore: sql<number | null>`avg(${aiQualityChecks.groundingScore})`,
    })
    .from(aiQualityChecks)
    .where(gte(aiQualityChecks.createdAt, since))
    .groupBy(aiQualityChecks.aiTask);
  return rows.map((r) => {
    const selfChecked = Number(r.selfChecked ?? 0);
    const confirmed = Number(r.confirmed ?? 0);
    return {
      aiTask: r.aiTask,
      generations: Number(r.generations ?? 0),
      selfChecked,
      failed: Number(r.failed ?? 0),
      confirmed,
      hallucinationRate: selfChecked > 0 ? confirmed / selfChecked : 0,
      avgGroundingScore: r.avgGroundingScore != null ? Number(r.avgGroundingScore) : null,
    };
  });
}

export interface ConfidenceDistribution {
  high: number;
  medium: number;
  low: number;
}

export async function getConfidenceDistribution(days = 30): Promise<ConfidenceDistribution> {
  const since = new Date(Date.now() - days * 86400_000);
  const [row] = await db
    .select({
      high: sql<number>`count(*) filter (where ${aiQualityChecks.confidence} = 'high')`,
      medium: sql<number>`count(*) filter (where ${aiQualityChecks.confidence} = 'medium')`,
      low: sql<number>`count(*) filter (where ${aiQualityChecks.confidence} = 'low')`,
    })
    .from(aiQualityChecks)
    .where(gte(aiQualityChecks.createdAt, since));
  return {
    high: Number(row?.high ?? 0),
    medium: Number(row?.medium ?? 0),
    low: Number(row?.low ?? 0),
  };
}
