import { z } from "zod";
import { withAiCache } from "@outrival/shared";
import { complete } from "../provider";
import { safeParseJson } from "../lib/parse";
import { validateCitations, type Citation, type GroundingValidation } from "./citations";
import type {
  Confidence,
  GroundedCallParams,
  GroundedQuality,
  GroundedResult,
} from "./types";

const ConfidenceSchema = z.enum(["low", "medium", "high"]);
const CitationSchema = z.object({
  assertion: z.string(),
  sourceQuote: z.string(),
});

const PASSED_GROUNDING: GroundingValidation = {
  passed: true,
  score: 1,
  failedCitations: [],
  validCitations: [],
};

/**
 * Generic grounded AI call (patch-24, the wrapper the 12 tasks route through).
 *
 * Augments the task's own prompt with grounding + confidence instructions and an
 * envelope format ({ output, citations, confidence }), runs the model through the
 * provider pool, parses the envelope (falling back to the bare output schema when
 * the model ignored the envelope), and validates the citations against the source.
 *
 * Pure: it never touches the DB. It returns the output unchanged plus a quality
 * envelope; the caller (job / API route) persists that to ai_quality_checks. The
 * self-check second pass (patch-24 layer 3) is wired in at the generation site so
 * it only runs on a fresh call, never on a cache hit.
 *
 * Returns null on a parse miss — same contract as the pre-grounding tasks.
 */
export async function groundedAiCall<T>(
  params: GroundedCallParams<T>,
): Promise<GroundedResult<T> | null> {
  const groundingEnabled =
    process.env.GROUNDING_VALIDATION_ENABLED !== "false" && (params.requireGrounding ?? true);
  const confidenceEnabled = params.requireConfidence ?? true;

  const augmentedPrompt = augmentPrompt(params.prompt, groundingEnabled, confidenceEnabled);
  const envelopeSchema = z.object({
    output: params.schema,
    citations: z.array(CitationSchema).optional(),
    confidence: ConfidenceSchema.optional(),
  });

  const run = async (): Promise<{ output: T; quality: GroundedQuality; raw: string } | null> => {
    const raw = await complete(params.config, {
      prompt: augmentedPrompt,
      json: true,
      ...(params.maxTokens ? { maxTokens: params.maxTokens } : {}),
    });

    let output: T;
    let citations: Citation[] = [];
    let confidence: Confidence = "medium";

    const enveloped = safeParseJson(raw, envelopeSchema);
    if (enveloped.ok) {
      output = enveloped.value.output;
      citations = enveloped.value.citations ?? [];
      confidence = enveloped.value.confidence ?? "medium";
    } else {
      // The model returned the bare output (ignored the envelope). Accept it —
      // grounding informs, it never blocks — with no citations and a neutral
      // confidence, so the whole pipeline never regresses on an un-enveloped reply.
      const bare = safeParseJson(raw, params.schema);
      if (!bare.ok) {
        console.error(`grounded ${params.taskName} parse failed:`, bare.error, "raw:", raw.slice(0, 500));
        return null;
      }
      output = bare.value;
    }

    const groundingValidation =
      groundingEnabled && citations.length > 0
        ? validateCitations(citations, params.sourceText)
        : PASSED_GROUNDING;

    const quality: GroundedQuality = {
      confidence,
      citations,
      groundingValidation,
      selfCheck: null,
      selfCheckTriggeredBy: null,
      flaggedForHumanReview: false,
    };

    // Self-check (patch-24 layer 3) is wired in here at the generation site in a
    // later step, inside this closure so it never runs on a cache hit.

    return { output, quality, raw };
  };

  if (params.cache) {
    const { value, cached } = await withAiCache<{ output: T; quality: GroundedQuality } | null>(
      params.cache.input,
      { namespace: params.cache.namespace, ttlSeconds: params.cache.ttlSeconds },
      async () => {
        const r = await run();
        return r ? { output: r.output, quality: r.quality } : null;
      },
    );
    if (!value) return null;
    return { output: value.output, quality: value.quality, generated: !cached, raw: "" };
  }

  const r = await run();
  if (!r) return null;
  return { output: r.output, quality: r.quality, generated: true, raw: r.raw };
}

function augmentPrompt(prompt: string, grounding: boolean, confidence: boolean): string {
  if (!grounding && !confidence) return prompt;

  let envelope = `${prompt}

<grounding>`;
  if (grounding) {
    envelope += `
For every factual assertion in your answer, provide an EXACT quote from the reference text above that supports it (verbatim, not a paraphrase). If you cannot quote support for an assertion, drop the assertion or lower your confidence.`;
  }
  if (confidence) {
    envelope += `
Rate your own confidence:
- "high": the data is explicit and unambiguous
- "medium": a reasonable inference with some extrapolation
- "low": not enough evidence, this is a hypothesis`;
  }
  envelope += `
Wrap your ENTIRE answer as a single JSON object, no markdown, no surrounding text:
{
  "output": <the object exactly as specified above>,${
    grounding
      ? `\n  "citations": [{ "assertion": "...", "sourceQuote": "...verbatim from the reference..." }],`
      : ""
  }${confidence ? `\n  "confidence": "low" | "medium" | "high"` : ""}
}
Write all text values in English.
</grounding>`;
  return envelope;
}
