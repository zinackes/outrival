import { db } from "../client";
import { aiQualityChecks } from "../schema";

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
