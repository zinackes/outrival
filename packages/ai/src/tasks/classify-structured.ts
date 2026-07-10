import { z } from "zod";
import { AI_CONFIG } from "../config";
import { groundedAiCall } from "../grounding/grounded-call";
import { attachQuality, type WithQuality } from "../grounding/types";
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
// in the SAME ORDER as the input list (zipped back by index below). Exported so
// the model-eval harness (src/eval) can validate candidate models against it.
export const StructuredOutputSchema = ClassificationSchema.extend({
  assessments: z.array(z.enum(["major", "minor", "trivial"])),
});

export interface ClassifyStructuredContext {
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
  const contextBlock = where ? `\nThese changes were detected on: ${where}.\n` : "";

  return `You are a competitive-intelligence analyst. Below is a list of STRUCTURAL changes detected on a competitor's homepage, already parsed by section and field (not a raw diff).
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
- Set the OVERALL severity from the rubric below, anchored on the most
  significant change: a single "major" change is usually "medium" or "high";
  reserve "critical" strictly for the rubric's critical test. Only minor/trivial
  changes ⇒ "low".
- is_significant is true if any change is "major".
</rules>

<severity-rubric>
"critical" triggers an IMMEDIATE email to the customer, bypassing all moderation.
Use it only when BOTH hold:
  (a) the change is a direct threat or opening for the customer's own positioning
      or revenue — a price undercut or pricing-structure change by a direct
      competitor, the launch of a directly competing flagship capability, a funding
      round >= $100M or an acquisition of a direct competitor, or entry into the
      customer's exact segment; AND
  (b) the useful reaction window is DAYS, not weeks.
If unsure between "critical" and "high", choose "high".
"high" — a material strategic move where reacting next week loses nothing: a
notable product launch, a quantified price change, a complete repositioning of the
hero/value proposition, a strategic hiring wave.
"medium" — real but incremental: a new job posting, a new page section, a
promotion, a plan-limit tweak.
"low" — cosmetic or informational: copy polish, testimonials/logos, navigation,
meta tags, documentation pages.
Severity is judged on the CONTENT of the change, never on the size of the diff —
a one-line diff can be critical; a huge redesign diff can be low.
</severity-rubric>

<category-rules>
Judge WHAT changed, never WHERE it appeared:
- pricing: any price, plan, tier, trial, or gating change, on any page.
- funding: a raise, acquisition, or valuation announcement, even on a blog post.
- product: shipped or announced capabilities, launches, integrations.
- hiring: job postings and team growth — even when they telegraph product direction.
- reviews: review-platform score or review-content movements only.
- content: messaging, positioning, or content-strategy changes (use only when none
  of the above applies).
When two genuinely apply, pick by this priority: pricing > funding > product >
hiring > reviews > content.
</category-rules>

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
  "category": "pricing|product|hiring|reviews|content|funding",
  "severity": "low|medium|high|critical",
  "is_significant": true|false,
  "reason": "one short sentence",
  "humanChangeBefore": "Project management for teams" or null,
  "humanChangeAfter": "AI-powered project intelligence" or null,
  "assessments": ["major", "minor", ...]
}
</format>`;
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
    JSON.stringify(changes),
  ].join("\n");

  const result = await groundedAiCall({
    taskName: "classify_change",
    config: AI_CONFIG.classification,
    prompt,
    sourceText: renderForPrompt(changes).slice(0, 8000),
    schema: StructuredOutputSchema,
    cache: { input: cacheKey, namespace: "classify-structured", ttlSeconds: CACHE_TTL_SECONDS },
  });
  if (!result) return null;

  const { assessments, ...classification } = result.output;
  // Zip the model's significances back onto the input changes by index. If the
  // model returned a mismatched length, default to "minor" — never crash.
  const perChangeAssessment: PerChangeAssessment[] = changes.map((c, i) => ({
    ...c,
    significance: assessments[i] ?? "minor",
  }));

  return attachQuality({ classification, perChangeAssessment }, result.quality);
}
