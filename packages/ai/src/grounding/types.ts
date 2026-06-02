import type { z } from "zod";
import type { Citation, GroundingValidation } from "./citations";
import type { AITaskConfig } from "../config";

export type Confidence = "low" | "medium" | "high";

// Result of the second-pass self-check (patch-24, layer 3). Lives here (not in the
// self-check module) so grounded-call and self-check share it without a cycle.
export interface SelfCheckResult {
  passed: boolean;
  issues: Array<{
    type: "factual_error" | "unsupported_claim" | "extrapolation" | "context_mix";
    description: string;
    affectedAssertion: string;
  }>;
  confidenceAdjustment: "none" | "downgrade";
  reviewerConfidence: Confidence;
}

export type SelfCheckTrigger = "systematic_battle_card" | "sampling" | "low_confidence";

// The serialisable quality envelope attached to a task's output and persisted to
// ai_quality_checks. `selfCheck` is null unless a second pass ran.
export interface GroundedQuality {
  confidence: Confidence;
  citations: Citation[];
  groundingValidation: GroundingValidation;
  selfCheck: SelfCheckResult | null;
  selfCheckTriggeredBy: SelfCheckTrigger | null;
  flaggedForHumanReview: boolean;
}

export interface GroundedResult<T> {
  output: T;
  quality: GroundedQuality;
  /** False on a cache hit — the metrics/self-check only count fresh generations. */
  generated: boolean;
  raw: string;
}

export interface GroundedCallParams<T> {
  /** ai_runs / ai_quality_checks task name, e.g. "classify_change". */
  taskName: string;
  config: AITaskConfig;
  /** The task's existing prompt; the source text is already embedded in it. */
  prompt: string;
  /** Reference text the citations are validated against (same source as the prompt). */
  sourceText: string;
  /** Zod schema of the OUTPUT — unchanged from the pre-grounding task. */
  schema: z.ZodSchema<T>;
  maxTokens?: number;
  requireGrounding?: boolean; // default true
  requireConfidence?: boolean; // default true
  /** Optional Redis cache (patch-09). Deterministic tasks only. */
  cache?: { input: string; namespace: string; ttlSeconds: number };
}

/** Output object with the quality envelope attached for the persisting caller. */
export type WithQuality<T> = T & { _quality: GroundedQuality };

export function attachQuality<T extends object>(
  output: T,
  quality: GroundedQuality,
): WithQuality<T> {
  return Object.assign(output as object, { _quality: quality }) as WithQuality<T>;
}
