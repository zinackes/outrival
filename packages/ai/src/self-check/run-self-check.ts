import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";
import type { Citation } from "../grounding/citations";
import type { Confidence, SelfCheckResult, SelfCheckTrigger } from "../grounding/types";

// Second-pass verification (patch-24, layer 3): a fresh model call that audits the
// first output for unsupported claims / over-extrapolation / mixed context. It does
// NOT rewrite the output — it only judges its factual rigour. Never cached (a
// verification must be fresh). Counts against the patch-22 AI quota like any call.

const SelfCheckOutputSchema = z.object({
  passed: z.boolean(),
  issues: z
    .array(
      z.object({
        type: z.enum(["factual_error", "unsupported_claim", "extrapolation", "context_mix"]),
        description: z.string(),
        affectedAssertion: z.string(),
      }),
    )
    .default([]),
  confidenceAdjustment: z.enum(["none", "downgrade"]).default("none"),
  reviewerConfidence: z.enum(["low", "medium", "high"]).default("medium"),
});

export interface SelfCheckParams {
  originalOutput: unknown;
  originalCitations: Citation[];
  sourceText: string;
  taskName: string;
}

export async function runSelfCheck(params: SelfCheckParams): Promise<SelfCheckResult | null> {
  const systemPrompt = `You are a quality reviewer for another AI. Verify that its output:
1. Makes no factual assertion unsupported by the source text.
2. Does not over-extrapolate beyond the data.
3. Introduces no information foreign to the context (no other company's facts).
You are NOT here to rewrite or improve the output — only to judge its factual rigour.

Original task: ${params.taskName}

The AI's output:
${JSON.stringify(params.originalOutput, null, 2)}

Citations the AI provided:
${JSON.stringify(params.originalCitations, null, 2)}

Source text:
---
${params.sourceText.slice(0, 8000)}
---

Reply with strict JSON only, no markdown, no preamble. Write all text in English:
{
  "passed": boolean,
  "issues": [{ "type": "factual_error" | "unsupported_claim" | "extrapolation" | "context_mix", "description": "...", "affectedAssertion": "..." }],
  "confidenceAdjustment": "none" | "downgrade",
  "reviewerConfidence": "low" | "medium" | "high"
}`;

  const raw = await complete(AI_CONFIG.classification, { prompt: systemPrompt, json: true });
  const parsed = safeParseJson(raw, SelfCheckOutputSchema);
  if (!parsed.ok) {
    console.error(`self-check ${params.taskName} parse failed:`, parsed.error);
    return null;
  }
  return parsed.value;
}

/**
 * When to spend a second pass: always on battle cards (the most visible critical
 * output), automatically on a low-confidence output, otherwise a random sample to
 * measure the global hallucination rate cheaply.
 */
export function decideIfSelfCheck(
  taskName: string,
  confidence: Confidence,
): { run: boolean; reason?: SelfCheckTrigger } {
  if (taskName === "generate_battle_card" && process.env.SELF_CHECK_BATTLE_CARDS !== "false") {
    return { run: true, reason: "systematic_battle_card" };
  }
  if (confidence === "low") {
    return { run: true, reason: "low_confidence" };
  }
  const samplingRate = Number(process.env.SELF_CHECK_SAMPLING_RATE);
  const rate = Number.isFinite(samplingRate) && samplingRate >= 0 ? samplingRate : 0.1;
  if (Math.random() < rate) {
    return { run: true, reason: "sampling" };
  }
  return { run: false };
}

export function downgradeConfidence(c: Confidence): Confidence {
  return c === "high" ? "medium" : "low";
}
