import { z } from "zod";
import { AI_CONFIG } from "../config";
import { groundedAiCall } from "../grounding/grounded-call";
import { attachQuality, type WithQuality } from "../grounding/types";
import type { StructuredChangeInput } from "./classify-structured";
import type { MyProductContext } from "./insight";

// Minimum overall severity for which we spend an extra AI call on a strategic
// narrative. Below this, the cost isn't worth it (patch-16 cost control).
const NARRATIVE_MIN_SEVERITY = (process.env.HOMEPAGE_NARRATIVE_MIN_SEVERITY ?? "medium").toLowerCase();

const RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

function rank(s: string): number {
  return RANK[s.toLowerCase()] ?? 0;
}

/**
 * Whether a change of the given overall severity clears the narrative threshold.
 * The caller (the job) gates on this BEFORE calling narrateChange so it only logs
 * an ai_run (patch-02) when a model call actually happens.
 */
export function shouldNarrate(severity: string): boolean {
  return rank(severity) >= rank(NARRATIVE_MIN_SEVERITY);
}

/**
 * The narrative's schema (Véracité P3). It had none: the task asked for free prose
 * and the job stored whatever came back, so a model that prefaced its answer, wrote
 * markdown, or answered in two paragraphs put all of it in front of the user. ONE
 * field, because that is exactly what the consumer does with it — `signals.narrative`
 * is a nullable text column rendered as one paragraph on the signal detail. Anything
 * wider would be inventing a contract nothing reads.
 */
export const NarrativeSchema = z.object({
  narrative: z.string(),
});

export type Narrative = z.infer<typeof NarrativeSchema>;

export interface NarrateChangeInput {
  changes: StructuredChangeInput[];
  competitor: { name: string; category: string };
  // The org's own product profile (org-level). When present, the narrative is
  // framed from our perspective; absent → the pre-P0 generic narrative.
  myProduct?: MyProductContext;
}

/**
 * Generate a short, sober strategic narrative explaining what a set of structural
 * homepage changes suggests (patch-16). Only worth calling for significant
 * changes (see shouldNarrate). NOT cached — the output is contextual/creative.
 * Returns null on an empty or failed generation; the caller treats the narrative
 * as optional and still creates the signal.
 *
 * Goes through groundedAiCall for the schema and the deterministic post-hoc check
 * (Véracité P3), NOT for the citation envelope — see its GROUNDING_POLICY entry. The
 * quality envelope rides back on `_quality`; when it reports an unsupported figure the
 * caller drops the narrative entirely and the signal keeps its deterministic
 * before/after. There is no second call: a re-roll used to happen here, and it was
 * both an unbudgeted AI call and no kind of repair.
 */
export async function narrateChange(
  input: NarrateChangeInput,
): Promise<WithQuality<Narrative> | null> {
  const major = input.changes.filter(
    (c) => !("significance" in c) || (c as { significance?: string }).significance !== "trivial",
  );
  const list = (major.length ? major : input.changes)
    .map((c) => `- [${c.kind}] ${c.field}: ${c.before ?? "∅"} → ${c.after ?? "∅"}`)
    .join("\n");

  // Narrative = descriptive CONTEXT about the competitor's move, deliberately distinct
  // from the signal's "so what" (which states the implication for OUR product). They
  // used to share the same "overlap / threat / gap" angle and printed the same analysis
  // twice; keeping the narrative competitor-descriptive stops that duplication.
  const angle =
    "what this move reveals about the competitor's own strategy and direction — how they're positioning, who they seem to be targeting, and where it fits their broader trajectory";

  // The exact text the model is shown, so the post-hoc check reads the same source
  // the narrative was written from — never a wider one it never saw.
  const shown = list.slice(0, 4000);

  const prompt = `You are a strategic competitive-intelligence analyst. Here is what changed on the homepage of ${input.competitor.name} (category: ${input.competitor.category}):

${shown}

Explain in 2-3 short sentences ${angle}. This is CONTEXT, not advice — describe the competitor's move; do NOT state what we should do about it or how it affects our product (that is covered separately). Sober, factual tone. No superlatives, no gratuitous speculation. Write in English. If you don't have enough information to say anything useful, answer exactly "Change noted, significance to be confirmed."

Reply ONLY with a valid JSON object, no markdown and no surrounding text.

<format>
{
  "narrative": "the explanation, 2-3 short sentences, plain text"
}
</format>`;

  const result = await groundedAiCall({
    taskName: "narrate_change",
    config: AI_CONFIG.insights,
    prompt,
    sourceText: shown,
    schema: NarrativeSchema,
  });
  if (!result) return null;

  const narrative = result.output.narrative.trim();
  if (!narrative) return null;
  return attachQuality({ narrative }, result.quality);
}
