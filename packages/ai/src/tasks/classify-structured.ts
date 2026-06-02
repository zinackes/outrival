import { z } from "zod";
import { withAiCache } from "@outrival/shared";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";
import { ClassificationSchema, type Classification } from "./classify";

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
// in the SAME ORDER as the input list (zipped back by index below).
const StructuredOutputSchema = ClassificationSchema.extend({
  assessments: z.array(z.enum(["major", "minor", "trivial"])),
});

interface ClassifyStructuredContext {
  sourceType?: string;
  competitorName?: string;
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
 * Classify a list of structural homepage changes (patch-16). Reasons over the
 * typed, located changes instead of a flat diff blob, returning an overall
 * severity/category plus a per-change significance. Uses the 70b "smart" model
 * (structure benefits from the stronger reasoning) and the patch-09 cache
 * (deterministic on its input).
 */
export async function classifyStructuredChanges(
  changes: StructuredChangeInput[],
  context: ClassifyStructuredContext = {},
): Promise<StructuredClassification | null> {
  if (changes.length === 0) return null;

  const where = [context.competitorName, context.sourceType === "homepage" ? "homepage" : context.sourceType]
    .filter(Boolean)
    .join(" — ");
  const contextBlock = where ? `\nThese changes were detected on: ${where}.\n` : "";

  const prompt = `You are a competitive-intelligence analyst. Below is a list of STRUCTURAL changes detected on a competitor's homepage, already parsed by section and field (not a raw diff).
${contextBlock}
<changes>
${renderForPrompt(changes).slice(0, 8000)}
</changes>

<rules>
- Judge each change's significance as "major", "minor", or "trivial".
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
- Set the OVERALL severity from the most significant change: a major change ⇒ "high" or "critical"; only minor/trivial changes ⇒ "low".
- is_significant is true if any change is "major".
</rules>

<task>
Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write all text values in English.

Identify the single MAIN change and describe it in plain language:
  - humanChangeBefore: the value BEFORE, phrased naturally
  - humanChangeAfter:  the value AFTER, phrased naturally
If you can't extract a clean before/after, return null for BOTH.

Return "assessments": an array with EXACTLY one significance per change, in the
SAME ORDER as the numbered list above.
</task>

<format>
{
  "category": "pricing|product|hiring|reviews|content|funding",
  "severity": "low|medium|high|critical",
  "is_significant": true|false,
  "reason": "one short sentence",
  "humanChangeBefore": "Project management for teams" or null,
  "humanChangeAfter": "AI-powered project intelligence" or null,
  "assessments": ["major", "minor", ...]
}
</format>`;

  const cacheKey = [
    context.sourceType ?? "",
    context.competitorName ?? "",
    JSON.stringify(changes),
  ].join("\n");

  const { value } = await withAiCache(
    cacheKey,
    { namespace: "classify-structured", ttlSeconds: CACHE_TTL_SECONDS },
    async () => {
      const raw = await complete(AI_CONFIG.classification, { prompt, json: true });
      const result = safeParseJson(raw, StructuredOutputSchema);
      if (!result.ok) {
        console.error("Structured classification parse failed:", result.error, "raw:", raw.slice(0, 500));
        return null;
      }
      return result.value;
    },
  );
  if (!value) return null;

  const { assessments, ...classification } = value;
  // Zip the model's significances back onto the input changes by index. If the
  // model returned a mismatched length, default to "minor" — never crash.
  const perChangeAssessment: PerChangeAssessment[] = changes.map((c, i) => ({
    ...c,
    significance: assessments[i] ?? "minor",
  }));

  return { classification, perChangeAssessment };
}
