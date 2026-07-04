import { complete } from "../provider";
import { AI_CONFIG } from "../config";
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
 */
export async function narrateChange(input: NarrateChangeInput): Promise<string | null> {
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

  const prompt = `You are a strategic competitive-intelligence analyst. Here is what changed on the homepage of ${input.competitor.name} (category: ${input.competitor.category}):

${list.slice(0, 4000)}

Explain in 2-3 short sentences ${angle}. This is CONTEXT, not advice — describe the competitor's move; do NOT state what we should do about it or how it affects our product (that is covered separately). Sober, factual tone. No superlatives, no gratuitous speculation. Write in English. If you don't have enough information to say anything useful, reply exactly: "Change noted, significance to be confirmed."

Reply with the explanation text only — no markdown, no preamble.`;

  const raw = await complete(AI_CONFIG.insights, { prompt });
  const text = raw.trim();
  return text.length > 0 ? text : null;
}
