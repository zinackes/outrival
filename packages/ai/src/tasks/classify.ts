import { z } from "zod";
import { formatDiffForPrompt, truncateDiffText } from "@outrival/shared";
import { AI_CONFIG } from "../config";
import { groundedAiCall } from "../grounding/grounded-call";
import { attachQuality, type WithQuality } from "../grounding/types";
import {
  MATERIALITY_RUBRIC,
  CATEGORY_RULES,
  SOURCE_LABELS,
  buildRecentSignalsBlock,
} from "./classify-shared";
import {
  MaterialitySchema,
  isSignificantFromMateriality,
  resolveSeverity,
  toMaterialityScores,
  type Materiality,
} from "./materiality";

const CACHE_TTL_SECONDS = Number(process.env.AI_CACHE_TTL_CLASSIFY_DAYS ?? 7) * 86400;

const CategoryEnum = z.enum([
  "pricing", "product", "hiring", "reviews", "content", "funding",
  // Kept accepted so a DETERMINISTIC synthesized classification (the wellknown
  // llms.txt signal) validates; deliberately absent from the classify prompt, so
  // the model itself never picks it.
  "api_developer",
  // Taxonomy wave 2 — model-chosen, present in the prompt's <format>.
  "partnerships", "ma", "leadership", "security_compliance", "ads",
]);

/**
 * The RESOLVED classification — what the rest of the pipeline consumes, and the
 * shape a worker synthesizes deterministically (Hacker News, wellknown, sitemap
 * comparison pages). `severity` and `is_significant` are authoritative here; on
 * the AI path they are computed from `materiality`, never taken from the model.
 */
export const ClassificationSchema = z.object({
  category: CategoryEnum,
  severity: z.enum(["low", "medium", "high", "critical"]),
  is_significant: z.boolean(),
  reason: z.string(),
  // Plain-language before/after of the main change, for the "Why this insight?"
  // panel (patch-14). nullable+optional so the model may return null when it
  // can't extract a clean pair, and so any cached classification that predates
  // these keys still parses (withAiCache returns the stored object without
  // re-validating).
  humanChangeBefore: z.string().nullable().optional(),
  humanChangeAfter: z.string().nullable().optional(),
  // The sub-scores the severity was derived from, carried through to the signal
  // row for audit. Absent on synthesized classifications (no model call).
  materiality: MaterialitySchema.optional(),
});

export type Classification = z.infer<typeof ClassificationSchema>;

/**
 * What the MODEL is asked for. It scores materiality and picks a category; it is
 * never asked for a severity or an is_significant — both are derived. `severity`
 * stays tolerated-but-ignored so a model that volunteers one anyway (they like to)
 * doesn't fail the parse and cost us a retry.
 */
export const ModelClassificationSchema = z.object({
  category: CategoryEnum,
  materiality: MaterialitySchema,
  reason: z.string(),
  humanChangeBefore: z.string().nullable().optional(),
  humanChangeAfter: z.string().nullable().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  is_significant: z.boolean().optional(),
});

/**
 * Turn the model's answer into the resolved classification: severity from the
 * mapping table + the category floor, is_significant from decision_impact. The
 * only place a severity is minted on the AI path.
 */
export function resolveClassification(
  model: z.infer<typeof ModelClassificationSchema>,
  evidence: string,
): Classification {
  const materiality: Materiality = model.materiality;
  return {
    category: model.category,
    severity: resolveSeverity(model.category, materiality, `${model.reason}\n${evidence}`),
    is_significant: isSignificantFromMateriality(materiality),
    reason: model.reason,
    humanChangeBefore: model.humanChangeBefore ?? null,
    humanChangeAfter: model.humanChangeAfter ?? null,
    materiality,
  };
}

export { toMaterialityScores };

export interface ClassifyContext {
  /** Monitor source type, e.g. "homepage" | "pricing" | "blog". */
  sourceType?: string;
  competitorName?: string;
  /**
   * Page-type hint for a custom-page monitor (config.hint: legal|team|product|
   * security|docs|other). Adds one prompt line ("this page is the competitor's
   * {hint} page") so the model weighs a diff on, say, a /security or ToS page
   * correctly — a big relevance win for the custom long-tail source.
   */
  hint?: string;
  /**
   * Recent signals already recorded for THIS competitor, newest first, each a
   * LABEL built by `formatCorroborationSurface` (never an insight sentence). They
   * are the other "independent surfaces" the corroboration axis scores against:
   * without them the model has no way to know whether a pricing move on the
   * homepage was already seen on the pricing page this week. Omitted → the model
   * has one surface and scores corroboration 1.
   */
  recentSignals?: string[];
}

/**
 * Build the `<context>` block prepended to the diff. Pure + exported so the hint
 * grounding (custom-page monitors) is unit-testable without a network call. Empty
 * string when there's nothing to say (no competitor / source / hint).
 */
export function buildClassifyContextBlock(context: ClassifyContext): string {
  const sourceLabel = context.sourceType
    ? (SOURCE_LABELS[context.sourceType] ?? context.sourceType)
    : null;
  const where = [context.competitorName, sourceLabel].filter(Boolean).join(" — ");
  const lines: string[] = [];
  if (where) lines.push(`This change was detected on: ${where}.`);
  if (context.hint) lines.push(`This page is the competitor's ${context.hint} page.`);

  // Capped at 5 lines / 160 chars each: this block rides in the VARIABLE part of
  // every classify call (it is not in the cached system prefix), so it is paid for
  // on each change. Five recent moves are enough to tell "already seen on another
  // surface" from "brand new".
  const recentBlock = buildRecentSignalsBlock(context.recentSignals ?? []);

  if (lines.length === 0) return recentBlock;
  return `<context>
${lines.join("\n")}
</context>
${recentBlock}`;
}

// Static instructions, byte-identical across EVERY classify call → sent as the
// `system` message so Groq/Cerebras auto-cache this long shared prefix for free
// (F2). Content is unchanged from the prior single-prompt form: the only variable
// parts (the page-type context + the diff) now live in the user message tail.
// Exported for the anti-divergence test and the eval harnesses (src/eval).
export const CLASSIFY_SYSTEM = `You are a competitive-intelligence analyst. Classify a change detected on a competitor.

Use the page type (provided with the change) to judge significance: rotating testimonials, social-proof counters, cosmetic copy/nav tweaks are usually NOT significant; pricing, plan, feature, hiring, or positioning changes are.

${MATERIALITY_RUBRIC}

${CATEGORY_RULES}

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write all text values in English.

Also identify the SINGLE most important change and describe just that one:
  - humanChangeBefore: the value BEFORE, phrased naturally (e.g. "Standard · $99/mo")
  - humanChangeAfter:  the value AFTER, phrased naturally (e.g. "Standard · $79/mo")
The BEFORE side comes from what the page no longer shows, the AFTER side from what
it now shows. Never read one side as the other: a headline the competitor DELETED is
not something they just announced.
Keep each side to a short phrase (at most ~8 words); describe only that one change,
never concatenate several. If you can't extract a clean before/after, return null
for BOTH fields.

<format>
{
  "category": "pricing|ma|funding|security_compliance|product|partnerships|leadership|hiring|reviews|ads|content",
  "materiality": { "decision_impact": 0-3, "urgency": 0-3, "corroboration": 0-3 },
  "reason": "one short sentence",
  "humanChangeBefore": "Standard · $99/mo" or null,
  "humanChangeAfter": "Standard · $79/mo" or null
}
</format>`;

export async function classifyChange(
  diffText: string,
  context: ClassifyContext = {},
): Promise<WithQuality<Classification> | null> {
  const contextBlock = buildClassifyContextBlock(context);

  // Variable payload only (context + diff) — the static instructions ride in
  // CLASSIFY_SYSTEM so the cacheable prefix stays byte-identical (F2).
  // Slice the raw diff FIRST, then label: capping the formatted string could cut a
  // block open and leave the model reading a side that never closes. The cap is
  // per SIDE — a flat slice starts at the removals and can spend the whole window
  // before reaching a single added line, which reads as a page that was deleted.
  const evidence = formatDiffForPrompt(truncateDiffText(diffText, 8000));
  const prompt = `${contextBlock}<change>
${evidence}
</change>`;

  // Key on the context too: the same diff on different page types / competitors /
  // hints now yields a different prompt, so it must not share a cache entry.
  const cacheKey = [
    context.sourceType ?? "",
    context.competitorName ?? "",
    context.hint ?? "",
    (context.recentSignals ?? []).slice(0, 5).join("|"),
    diffText,
  ].join("\n");
  const result = await groundedAiCall({
    taskName: "classify_change",
    config: AI_CONFIG.classificationFast,
    system: CLASSIFY_SYSTEM,
    prompt,
    sourceText: evidence,
    schema: ModelClassificationSchema,
    // Namespace bumped to "-materiality": withAiCache returns a stored entry
    // WITHOUT re-validating it, so entries written by the pre-materiality prompt
    // (a model-chosen severity, no sub-scores) would flow into the new resolver as
    // undefined materiality. A new namespace retires them instead. "-polarity"
    // retires the entries answered from the unlabelled diff blob for the same
    // reason: their before/after may be the two sides swapped. "-bothsides"
    // retires the entries answered from a prompt whose flat 8000-char cap could
    // have shown the removals alone: the key hashes the WHOLE diff, so those would
    // otherwise keep being served for a diff the model now reads differently.
    cache: {
      input: cacheKey,
      namespace: "classify-materiality-polarity-bothsides",
      ttlSeconds: CACHE_TTL_SECONDS,
    },
  });
  if (!result) return null;
  return attachQuality(resolveClassification(result.output, diffText), result.quality);
}
