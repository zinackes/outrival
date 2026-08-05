import { z } from "zod";
import { AI_CONFIG } from "../config";
import { groundedAiCall } from "../grounding/grounded-call";
import { attachQuality, type WithQuality } from "../grounding/types";
import { ModelClassificationSchema, resolveClassification, type Classification } from "./classify";
import { MATERIALITY_RUBRIC, CATEGORY_RULES, buildRecentSignalsBlock } from "./classify-shared";

const CACHE_TTL_SECONDS = Number(process.env.AI_CACHE_TTL_CLASSIFY_DAYS ?? 7) * 86400;

/**
 * A single structural homepage change, decoupled from @outrival/scrapers'
 * StructuredChange so @outrival/ai stays a leaf (no scrapers dependency). The
 * worker's StructuredChange is structurally assignable to this.
 */
export interface StructuredChangeInput {
  kind: string;
  field: string;
  before: string | null;
  after: string | null;
  bodyDiff?: { added: string[]; removed: string[] };
}

export interface PerChangeAssessment extends StructuredChangeInput {
  significance: "major" | "minor" | "trivial";
}

export interface StructuredClassification {
  /** Overall classification, shape-compatible with the lexical classifier. */
  classification: Classification;
  /** Per-change significance, for the "Why this insight?" breakdown (patch-14/16). */
  perChangeAssessment: PerChangeAssessment[];
}

// The model returns the overall classification plus a significance per change,
// in the SAME ORDER as the input list (zipped back by index below). Exported so
// the model-eval harness (src/eval) can validate candidate models against it.
export const StructuredOutputSchema = ModelClassificationSchema.extend({
  assessments: z.array(z.enum(["major", "minor", "trivial"])),
});

export interface ClassifyStructuredContext {
  sourceType?: string;
  competitorName?: string;
  /**
   * Other surfaces for the corroboration axis, as `formatCorroborationSurface`
   * labels — see ClassifyContext.recentSignals.
   */
  recentSignals?: string[];
}

function renderForPrompt(changes: StructuredChangeInput[]): string {
  return changes
    .map((c, i) => {
      const base = `${i + 1}. [${c.kind}] ${c.field}: ${c.before ?? "∅"} → ${c.after ?? "∅"}`;
      if (c.bodyDiff && (c.bodyDiff.added.length || c.bodyDiff.removed.length)) {
        const removed = c.bodyDiff.removed.map((l) => `     - ${l}`).join("\n");
        const added = c.bodyDiff.added.map((l) => `     + ${l}`).join("\n");
        return [base, removed, added].filter(Boolean).join("\n");
      }
      return base;
    })
    .join("\n");
}

/**
 * Pure prompt builder — exported so the model-eval harness (src/eval) can replay
 * the exact prompt against candidate models without the cache/grounding layers.
 */
export function buildStructuredClassifyPrompt(
  changes: StructuredChangeInput[],
  context: ClassifyStructuredContext = {},
): string {
  const where = [context.competitorName, context.sourceType === "homepage" ? "homepage" : context.sourceType]
    .filter(Boolean)
    .join(" — ");
  const block = buildRecentSignalsBlock(context.recentSignals ?? []);
  const recentBlock = block ? `\n${block}` : "";
  const contextBlock =
    (where ? `\nThese changes were detected on: ${where}.\n` : "") + recentBlock;

  return `You are a competitive-intelligence analyst. Below is a list of STRUCTURAL changes detected on a competitor's homepage, already parsed by section and field (not a raw diff).
${contextBlock}
<changes>
${renderForPrompt(changes).slice(0, 8000)}
</changes>

<rules>
- Judge each change's significance as "major", "minor", or "trivial".
- EXCEPTION FIRST: if a change's before or after side looks like an anti-bot or
  error interstitial ("Robot Challenge Screen", "Checking the site connection
  security", "Just a moment...", a bare domain as the headline), that change is a
  capture artifact of our own scraper, not a competitor move — mark it "trivial"
  and never anchor the overall severity on it.
- A hero_headline_changed is ALWAYS at least "major".
- A section_added whose field is sections[pricing] is ALWAYS at least "major".
- navigation_changed alone is "minor".
- meta_changed alone is "minor".
- social_proof_changed (a count) alone is "minor".
- section_reordered with no other change is "trivial".
- numeric_claim_changed is "major" when the value moved a lot (e.g. a user/customer count or scale metric jumping), else "minor" — it reflects a business metric the competitor advertises.
- customer_logo_added / customer_logo_removed is "minor" alone (a marquee customer won or churned).
- testimonial_added / testimonial_removed alone is "minor".
- visual_redesign alone is "minor" (a redesign with no copy move is noteworthy, not a positioning change).
- Score the OVERALL materiality with the rubric below, anchored on the MOST
  significant change in the list — never on the number of changes. If every change
  is minor or trivial, decision_impact is 0.
</rules>

${MATERIALITY_RUBRIC}

${CATEGORY_RULES}

<task>
Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write all text values in English.

Identify the SINGLE most important change and describe just that one:
  - humanChangeBefore: the value BEFORE — a short phrase, at most ~8 words
  - humanChangeAfter:  the value AFTER  — a short phrase, at most ~8 words
Describe ONLY that one change; never concatenate several changes into one string,
and never paste raw section text. If you can't extract a clean before/after,
return null for BOTH.

Return "assessments": an array with EXACTLY one significance per change, in the
SAME ORDER as the numbered list above.
</task>

<format>
{
  "category": "pricing|ma|funding|security_compliance|product|partnerships|leadership|hiring|reviews|ads|content",
  "materiality": { "decision_impact": 0-3, "urgency": 0-3, "corroboration": 0-3 },
  "reason": "one short sentence",
  "humanChangeBefore": "Project management for teams" or null,
  "humanChangeAfter": "AI-powered project intelligence" or null,
  "assessments": ["major", "minor", ...]
}
</format>`;
}

/**
 * Zip the model's significances back onto the input changes by index — or refuse.
 *
 * A wrong-length array is a PARSE FAILURE, not a shape to patch up (audit §3.2). The
 * prompt asks for exactly one significance per change, IN ORDER, and the whole point
 * of the per-change breakdown is that assessment i describes change i. Coercing the
 * missing tail to "minor" — as this did until Véracité P3 — published a fabricated
 * judgement per change under the model's name, silently, as a success, straight into
 * the "Why this insight?" panel. Null instead: the caller already has a retry path
 * for a parse miss, and this IS one.
 */
export function zipAssessments(
  changes: StructuredChangeInput[],
  assessments: Array<"major" | "minor" | "trivial">,
): PerChangeAssessment[] | null {
  if (assessments.length !== changes.length) return null;
  return changes.map((c, i) => ({ ...c, significance: assessments[i]! }));
}

/**
 * Classify a list of structural homepage changes (patch-16). Reasons over the
 * typed, located changes instead of a flat diff blob, returning an overall
 * severity/category plus a per-change significance. Uses the 70b "smart" model
 * (structure benefits from the stronger reasoning) and the patch-09 cache
 * (deterministic on its input).
 */
export async function classifyStructuredChanges(
  changes: StructuredChangeInput[],
  context: ClassifyStructuredContext = {},
): Promise<WithQuality<StructuredClassification> | null> {
  if (changes.length === 0) return null;

  const prompt = buildStructuredClassifyPrompt(changes, context);

  const cacheKey = [
    context.sourceType ?? "",
    context.competitorName ?? "",
    (context.recentSignals ?? []).slice(0, 5).join("|"),
    JSON.stringify(changes),
  ].join("\n");

  const result = await groundedAiCall({
    taskName: "classify_change",
    config: AI_CONFIG.classification,
    prompt,
    sourceText: renderForPrompt(changes).slice(0, 8000),
    schema: StructuredOutputSchema,
    // Namespace bumped alongside the lexical classifier — see classify.ts.
    cache: {
      input: cacheKey,
      namespace: "classify-structured-materiality",
      ttlSeconds: CACHE_TTL_SECONDS,
    },
  });
  if (!result) return null;

  const { assessments, ...model } = result.output;
  const perChangeAssessment = zipAssessments(changes, assessments);
  if (!perChangeAssessment) {
    console.error(
      `classify_structured parse failed: ${assessments.length} assessments for ${changes.length} changes`,
    );
    return null;
  }
  const classification = resolveClassification(model, renderForPrompt(changes));

  return attachQuality({ classification, perChangeAssessment }, result.quality);
}
