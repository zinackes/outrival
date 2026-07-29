import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";
import type { Claim } from "./types";

// Step 1 of the faithfulness chain: decompose a publishable output into ATOMIC
// claims — one sentence, one verifiable fact — each carrying the passage of the
// source it invokes. One FAST structured call (the pool's small model), never
// cached: the output it decomposes is fresh by definition.
//
// Independent of the citation envelope the model may have produced at generation
// time (generate_signal and generate_digest run with grounding OFF for cost), so
// the chain works the same on every gated task.

const ExtractSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string(),
        // "" is a legitimate answer and the interesting one: nothing in the
        // source backs this sentence. It fails the fuzzy pass and goes to the judge.
        source_quote: z.string(),
      }),
    )
    .default([]),
});

/** Bound the prompt (and the judge's) — same order of magnitude as the other tasks. */
const SOURCE_CHARS = 12_000;
const OUTPUT_CHARS = 6_000;
/** Past this many, an output is not a claim list any more — keep the cost bounded. */
const MAX_CLAIMS = 25;

const EXTRACT_SYSTEM = `You split an AI-written output into ATOMIC CLAIMS so each one can be fact-checked on its own.

An atomic claim is ONE self-contained sentence stating ONE verifiable fact: a price, a plan, a feature, a number, a date, a rating, a named company, a capability, a comparison.

For every claim, quote the passage of the SOURCE that supports it:
- Quote it VERBATIM — copy the characters from the source, never rewrite them.
- If NOTHING in the source supports the claim, set "source_quote" to "" (empty string). Do not invent a quote, do not quote the output itself, and do not quote a passage that is merely about the same topic.
- When the source is a change with <removed> and <added> sides, they are NOT interchangeable. <removed> is text that was DELETED. A claim that something IS the case, was launched, or was announced is supported ONLY by <added>. Quoting <removed> for it is exactly the mistake this check exists to catch, so set "source_quote" to "" instead and let the claim be judged. Quote <removed> only for a claim that the competitor DROPPED or STOPPED saying something.

Ignore pure opinion, advice and recommendations that state no fact ("consider positioning against them"), and ignore section labels. Extract at most ${MAX_CLAIMS} claims, the most consequential first.

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write all text values in English.

<format>
{ "claims": [{ "text": "one factual sentence", "source_quote": "verbatim from the source, or empty" }] }
</format>`;

export interface ExtractClaimsParams {
  /** The publishable output, as generated. */
  output: unknown;
  /** The evidence the output must be traceable to. */
  sourceText: string;
  /** What is being checked, e.g. "sales battle card" — grounds the extractor. */
  outputKind: string;
}

/** Returns null on a parse miss / provider failure — the caller must fail OPEN. */
export async function extractClaims(params: ExtractClaimsParams): Promise<Claim[] | null> {
  const prompt = `The output below is a ${params.outputKind} written by another AI from the source that follows.

<output>
${JSON.stringify(params.output).slice(0, OUTPUT_CHARS)}
</output>

<source>
${params.sourceText.slice(0, SOURCE_CHARS)}
</source>`;

  const raw = await complete(AI_CONFIG.classificationFast, {
    system: EXTRACT_SYSTEM,
    prompt,
    json: true,
    maxTokens: 2048,
  });
  const parsed = safeParseJson(raw, ExtractSchema);
  if (!parsed.ok) {
    console.error("faithfulness extract_claims parse failed:", parsed.error);
    return null;
  }
  return parsed.value.claims
    .slice(0, MAX_CLAIMS)
    .map((c) => ({ text: c.text, citedQuote: c.source_quote }));
}
