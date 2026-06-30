import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";
import { ExtractorSpecSchema, type ExtractorSpec } from "@outrival/shared";

/**
 * AI self-heal step (patch-30): generate a DETERMINISTIC CSS-selector extractor for
 * a page so EVERY subsequent scrape extracts the data with ZERO AI (replayed by
 * @outrival/scrapers' replayExtractor, cached in `parser_extractors`). This is the
 * ONLY new AI call the pipeline adds, and it runs only on a cache miss or when a
 * cached extractor stops validating — the "cold path" the patch is built around.
 *
 * Uses the smart tier (AI_CONFIG.classification): producing robust selectors needs
 * the stronger reasoning. Returns null ONLY on a genuine parse/schema miss (malformed
 * JSON). A VALID answer that simply has no extractable structure (the empty-fields
 * sentinel, or no `list` selector) is returned as-is — the model honestly saying it
 * can't build a deterministic extractor for this page, NOT a failure: the caller
 * replays it (yields nothing → falls through to the direct-AI floor) and the ai_runs
 * row stays `success`. Conflating the two used to brand ~73% of calls `parse_failed`.
 */
export type ExtractorKind = "pricing" | "jobs";

interface Guide {
  item: string;
  fields: string;
  format: string;
}

const GUIDES: Record<ExtractorKind, Guide> = {
  pricing: {
    item: "one pricing plan / tier",
    fields: `- "plan_name": the tier name (e.g. Free, Starter, Pro, Enterprise)
- "price": the numeric amount — ALWAYS set "transform": "number". For quote-based tiers ("Contact sales") set "nullable": true so a missing price resolves to null — but STILL give a non-empty selector (point it at the price/CTA slot; nullable handles the empty match). NEVER use an empty selector.
- "currency": a selector for the currency symbol/code shown near the price, "nullable": true
- "billing_period": a selector for the "/month" or "/year" label if one exists, "nullable": true`,
    format: `{"version":1,"list":"<selector matching EACH plan card>","fields":{"plan_name":{"selector":"..."},"price":{"selector":"...","transform":"number","nullable":true},"currency":{"selector":"...","nullable":true},"billing_period":{"selector":"...","nullable":true}}}`,
  },
  jobs: {
    item: "one job posting",
    fields: `- "title": the job title
- "location": a selector for the location text if present, "nullable": true`,
    format: `{"version":1,"list":"<selector matching EACH job row>","fields":{"title":{"selector":"..."},"location":{"selector":"...","nullable":true}}}`,
  },
};

export async function generateExtractor(
  kind: ExtractorKind,
  prunedHtml: string,
): Promise<ExtractorSpec | null> {
  const guide = GUIDES[kind];
  const prompt = `You are generating a DETERMINISTIC HTML extractor (CSS selectors) for a ${kind} page, so future scrapes can extract the data WITHOUT any LLM.

Below is the pruned HTML skeleton (tags + class/id kept, copy truncated).

<html>
${prunedHtml}
</html>

<task>
Produce a JSON "extractor spec" that, replayed with cheerio, yields the ${kind} data.
- "list": a CSS selector matching EACH ${guide.item} (a repeated element).
- "fields": for each field below, a NON-EMPTY CSS selector RELATIVE to one item, optionally with
  "attr" (read an attribute instead of the text) and "transform" ("number" for prices/counts, "trim" default, "lower").
- EVERY field's "selector" must be a non-empty string. If a field has no place in the page, OMIT the field entirely — never emit "selector": "".
- Prefer STABLE selectors: semantic tags, meaningful class names, data-* attributes, ARIA roles.
- AVOID :nth-child and hashed/utility classes (e.g. "css-1a2b3c", "sc-xyz", long Tailwind chains) — they break on the next deploy.
- Fields to extract:
${guide.fields}
- If the data is NOT present in this HTML, reply with {"version":1,"fields":{}} (empty fields).

Reply ONLY with the JSON object, no markdown, no surrounding text.
</task>

<format>
${guide.format}
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 1024 });
  const result = safeParseJson(raw, ExtractorSpecSchema);
  if (!result.ok) {
    console.error(`generate-extractor parse failed (${kind}):`, result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  // A valid {"version":1,"fields":{}} (the prompt's "data not present" sentinel) or a
  // spec with no `list` is a VALID response — the model couldn't locate a repeated
  // structure, not a parse failure. Return it as-is: replayExtractor yields nothing,
  // the caller's plausibility gate falls through to the AI floor, and the spec is never
  // persisted (only a stage that validates is upserted). Reserving null for the
  // safeParseJson miss above keeps the generate_extractor parse_failed rate honest.
  return result.value;
}
