import { z } from "zod";
import { AI_CONFIG } from "../config";
import { groundedAiCall } from "../grounding/grounded-call";
import { attachQuality, type WithQuality } from "../grounding/types";
import type { Classification } from "./classify";

export const InsightSchema = z.object({
  insight: z.string(),
  so_what: z.string(),
  recommended_action: z.string().nullable(),
});

export type Insight = z.infer<typeof InsightSchema>;

/**
 * The org's OWN product profile (org-level, `organizations.productProfile`). When
 * present, the insight is judged from the user's perspective — the `so_what` states
 * how the competitor's change affects OUR positioning, not a generic implication.
 * Absent (org not onboarded yet) → the prompt is identical to the pre-P0 generic one.
 */
export interface MyProductContext {
  category: string;
  audience: string;
  valueProp: string;
}

/**
 * Map a stored `organizations.productProfile` jsonb onto MyProductContext. Tolerant
 * of partial/legacy profiles; returns undefined when nothing usable is present so
 * the insight/narrative/digest prompts fall back to their generic form. Shared by
 * every consumer (signal insight, narration, digest) so the mapping lives in one place.
 */
export function toMyProductContext(profile: unknown): MyProductContext | undefined {
  if (!profile || typeof profile !== "object") return undefined;
  const p = profile as Record<string, unknown>;
  const category = typeof p.category === "string" ? p.category : "";
  const audience = typeof p.audience === "string" ? p.audience : "";
  const valueProp = typeof p.valueProp === "string" ? p.valueProp : "";
  if (!category && !audience && !valueProp) return undefined;
  return { category, audience, valueProp };
}

/**
 * Pure prompt builder — exported so the conditional `<my_product>` block can be
 * unit-tested without hitting the model.
 */
export function buildInsightPrompt(
  diffText: string,
  competitorName: string,
  competitorCategory: string | null,
  classification: Classification,
  myProduct?: MyProductContext,
): string {
  const myProductBlock = myProduct
    ? `
<my_product>
This is OUR product — the change above is a COMPETITOR's. Judge it from our perspective.
Category: ${myProduct.category}
Audience: ${myProduct.audience}
Value proposition: ${myProduct.valueProp}
</my_product>
`
    : "";

  const soWhatGuidance = myProduct
    ? "Strategic implication for OUR product specifically — whether it overlaps with our positioning, threatens our differentiation, or opens a gap we can exploit. 1-2 sentences"
    : "Strategic implication for the user, 1-2 sentences";

  return `<context>
Competitor: ${competitorName}
Product category: ${competitorCategory ?? "unknown"}
Change type: ${classification.category} (severity ${classification.severity})
</context>

<change>
${diffText.slice(0, 8000)}
</change>
${myProductBlock}
<task>
Generate a strategic insight for this competitor change.
Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write all text values in English.
</task>

<format>
{
  "insight": "What happened, 1-2 factual sentences",
  "so_what": "${soWhatGuidance}",
  "recommended_action": "A concrete action, or null"
}
</format>`;
}

export async function generateInsight(
  diffText: string,
  competitorName: string,
  competitorCategory: string | null,
  classification: Classification,
  myProduct?: MyProductContext,
  // P1 — force verbatim-citation grounding for this call. generate_signal opts out
  // of grounding by default (cost), but lexical diffs (a raw blob handed to the
  // model) are the most hallucination-prone path; the caller turns it on for those.
  requireGrounding?: boolean,
): Promise<WithQuality<Insight> | null> {
  const prompt = buildInsightPrompt(
    diffText,
    competitorName,
    competitorCategory,
    classification,
    myProduct,
  );

  const result = await groundedAiCall({
    taskName: "generate_signal",
    config: AI_CONFIG.insights,
    prompt,
    sourceText: diffText.slice(0, 8000),
    schema: InsightSchema,
    ...(requireGrounding ? { requireGrounding: true } : {}),
  });
  return result ? attachQuality(result.output, result.quality) : null;
}
