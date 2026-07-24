import { z } from "zod";
import { AI_CONFIG } from "../config";
import { groundedAiCall } from "../grounding/grounded-call";

const CACHE_TTL_SECONDS = Number(process.env.AI_CACHE_TTL_CLASSIFY_DAYS ?? 7) * 86400;

// Semantic gate: does the extracted FACT differ, or did the competitor just say
// the same thing differently?
//
// evaluateSignificance (filters/significance.ts) already drops diffs with no
// content — hashes, timestamps, nonces. It cannot drop a diff that is full of real
// prose saying nothing new, which is what a marketing team shipping a copy pass
// produces: "Ship faster with less overhead" → "Move faster, with less overhead".
// The classifier reliably calls that a positioning change, and the customer gets a
// signal about nothing. This gate runs before classification and answers one
// question, so a rewrite never enters the pipeline in the first place.
//
// Conservative by construction, like evaluateSignificance: the prompt names
// "substantive" as the default and the caller treats a null (parse miss, provider
// down) as substantive. A missed suppression costs one noisy signal; a wrong
// suppression loses a real one silently.

const GateSchema = z.object({
  substantive: z.boolean(),
  reason: z.string(),
});

export interface CosmeticGateResult {
  substantive: boolean;
  reason: string;
}

const GATE_SYSTEM = `You decide whether a detected change on a competitor's page carries NEW INFORMATION, or whether it is the same information expressed differently.

Answer "substantive": false ONLY when every difference is one of:
- rewording that preserves the meaning (synonyms, tone, shorter/longer phrasing)
- reordering of sections, list items, or navigation entries
- formatting, punctuation, casing, or whitespace
- a boilerplate element rotating (copyright year, cookie banner, testimonial carousel)

Answer "substantive": true when ANY difference adds, removes, or alters a FACT:
a price, a plan or tier, a limit or quota, a named capability or integration, a
date, a number, a claim about scale or customers, a named company or person, a
certification, a job role, a policy or contractual term.

If you are unsure, or the two sides are hard to compare, answer true. Missing a
rewrite is cheap; discarding a real change is not.

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write all text values in English.

<format>
{ "substantive": true|false, "reason": "one short sentence" }
</format>`;

/**
 * Returns null on a parse miss / provider failure — the caller MUST read null as
 * "substantive" and continue to classification.
 */
export async function isSubstantiveChange(
  diffText: string,
  context: { sourceType?: string; competitorName?: string } = {},
): Promise<CosmeticGateResult | null> {
  const where = [context.competitorName, context.sourceType].filter(Boolean).join(" — ");
  const source = diffText.slice(0, 8000);
  const prompt = `${where ? `This change was detected on: ${where}.\n` : ""}<change>
${source}
</change>`;

  const result = await groundedAiCall({
    taskName: "cosmetic_gate",
    config: AI_CONFIG.classificationFast,
    system: GATE_SYSTEM,
    prompt,
    sourceText: source,
    schema: GateSchema,
    cache: {
      input: [context.sourceType ?? "", diffText].join("\n"),
      namespace: "cosmetic-gate",
      ttlSeconds: CACHE_TTL_SECONDS,
    },
  });
  return result ? result.output : null;
}

/**
 * Sources whose diff is a LIST delta (a sorted set of URLs, subdomains, video ids,
 * news items), not prose. "Did the wording change?" is meaningless there — a new
 * entry is new by construction — and a gate call could only ever suppress a real
 * discovery. They skip the gate entirely.
 */
const LIST_SHAPED_SOURCES = new Set([
  "sitemap",
  "subdomains",
  "youtube",
  "news",
  "hackernews",
  "wellknown",
  "comparison_page",
  // `docs`: both modes are list deltas — a canonical OpenAPI operation/schema listing,
  // or the docs sitemap's page list. A new endpoint is a new endpoint; there is no
  // wording to have been rephrased.
  "docs",
  // `roadmap`: a sorted "[status] title — votes N+" listing of a Canny/ProductBoard
  // portal. Every line the diff shows is a status move, a vote band crossing or an
  // entry appearing/disappearing — facts, not phrasing. Asking "was this reworded?"
  // could only ever suppress one of them.
  "roadmap",
]);

export function gateAppliesTo(sourceType: string | undefined): boolean {
  return !!sourceType && !LIST_SHAPED_SOURCES.has(sourceType);
}

/**
 * The whole suppression decision, as one pure predicate — so the FAIL-OPEN
 * property is a tested invariant rather than something you have to re-read the
 * job to confirm. Only an explicit `substantive: false` on an eligible generic
 * change suppresses; a null gate (parse miss, provider down, breaker open) never
 * does.
 *
 * `isStructured` exempts the structured homepage path, whose relevance scoring and
 * volatile-line learning already dropped cosmetic churn upstream.
 */
export function suppressesAsCosmetic(
  gate: CosmeticGateResult | null,
  opts: { isStructured: boolean; sourceType?: string },
): gate is CosmeticGateResult {
  if (opts.isStructured) return false;
  if (!gateAppliesTo(opts.sourceType)) return false;
  return gate !== null && gate.substantive === false;
}
