import type { z } from "zod";
import type { Citation, GroundingValidation } from "./citations";
import type { VerifiableToken } from "./posthoc-grounding";
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

/**
 * Result of the deterministic post-hoc grounding check (Véracité P3). Costs no
 * tokens and never re-calls the model: every figure and quotation in the output is
 * looked for in the source the model was shown (see grounding/posthoc-grounding).
 *
 * `skipped` is NOT a failure and never blocks anything — it means the check could
 * not run honestly (no source to check against, or a reply cut off at its ceiling
 * whose half-written figures would flag spuriously). Same posture as the
 * faithfulness gate: an unavailable check is silence, not a verdict.
 */
export interface PostHocGrounding {
  status: "verified" | "unverified" | "skipped";
  /** The figures/quotations the source does not support. Empty unless unverified. */
  unverified: VerifiableToken[];
  /** How many tokens were checked — 0 means "nothing to check", not "clean". */
  checked: number;
  reason?: "no_source" | "truncated_output";
}

// The serialisable quality envelope attached to a task's output and persisted to
// ai_quality_checks. `selfCheck` is null unless a second pass ran.
export interface GroundedQuality {
  confidence: Confidence;
  citations: Citation[];
  groundingValidation: GroundingValidation;
  selfCheck: SelfCheckResult | null;
  selfCheckTriggeredBy: SelfCheckTrigger | null;
  flaggedForHumanReview: boolean;
  /** Null for the tasks the post-hoc policy doesn't cover (see GROUNDING_POLICY). */
  postHoc: PostHocGrounding | null;
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
  /**
   * Static instructions (role, rules, schema) sent as a separate `system` message
   * so the variable payload stays at the tail of `prompt` and the static prefix is
   * byte-identical across calls — auto-cached free by Groq/Cerebras (F2). Tasks
   * opt in by splitting their prompt; omit to keep one combined user message.
   */
  system?: string;
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

/**
 * Attach the quality envelope to a task's output as a NON-ENUMERABLE property, so
 * `JSON.stringify` (and therefore Drizzle jsonb persistence, the Redis cache, and
 * object spreads) never serialises it into stored domain data — only an explicit
 * `output._quality` read sees it. Callers' output path is unchanged; the persisting
 * job/route reads `._quality`.
 */
/** A neutral quality envelope (no citations, no self-check) for fallback paths. */
export function emptyQuality(confidence: Confidence = "low"): GroundedQuality {
  return {
    confidence,
    citations: [],
    groundingValidation: { passed: true, score: 1, failedCitations: [], validCitations: [] },
    selfCheck: null,
    selfCheckTriggeredBy: null,
    flaggedForHumanReview: false,
    postHoc: null,
  };
}

export function attachQuality<T extends object>(
  output: T,
  quality: GroundedQuality,
): WithQuality<T> {
  Object.defineProperty(output, "_quality", {
    value: quality,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return output as WithQuality<T>;
}
