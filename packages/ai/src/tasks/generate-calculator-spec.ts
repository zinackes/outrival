import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";
import { CalculatorSpecSchema, type CalculatorSpec } from "@outrival/shared";

/**
 * AI heal step for calculator probing (P4) — the ONLY AI call the phase adds,
 * and it runs at most once per competitor when the deterministic heuristics
 * cannot find the quantity control or the total on a page we know is a
 * calculator (`dynamic` + hasCalculator). The result is cached in
 * `calculator_specs` and replayed by the probe with zero AI on every later run.
 *
 * The model is asked WHERE things are, never WHAT they say. It emits two CSS
 * selectors and the unit wording it read next to the control; the probe then
 * resolves that wording through the deterministic unit catalog (a unit the
 * catalog doesn't know is refused, not guessed) and parses every amount in code.
 * No price ever passes through a model on this path — a measured cost has to be
 * something the competitor's own page computed and displayed, not something an
 * LLM reported having seen.
 *
 * Uses the smart tier, like generateExtractor: producing a selector that
 * survives a re-render is the reasoning-heavy part. Returns null on a parse or
 * schema miss.
 */
export async function generateCalculatorSpec(prunedHtml: string): Promise<CalculatorSpec | null> {
  const prompt = `You are locating the interactive parts of a SaaS pricing CALCULATOR so a program can drive it deterministically, without any LLM at run time.

Below is the pruned HTML skeleton of a pricing page (tags + class/id/data-* kept, copy truncated).

<html>
${prunedHtml}
</html>

<task>
Identify TWO things and reply with a JSON object:
1. "control" — the input the visitor changes to say HOW MUCH they will use (a range slider, a number field, or a quantity <select>). Give:
   - "selector": a CSS selector matching that input, resolved against the document
   - "kind": one of "range", "number", "select"
   - "unit": the unit the control counts, written as the page writes it ("monthly tracked users", "API requests", "GB of storage", "seats"). Copy the page's wording — do not translate or normalise it.
   - "planName": the plan/tier the calculator prices, if the page names one; otherwise null
2. "total" — the element that displays the resulting price the visitor would pay. Give:
   - "selector": a CSS selector matching that element (the smallest element that contains the amount)

Rules:
- Prefer STABLE selectors: ids, data-* attributes, semantic classes. AVOID hashed/utility classes ("css-1a2b3c", long Tailwind chains) and :nth-child where anything better exists.
- The control must be a real form element (input/select) — not a decorative div.
- The total must be an element whose TEXT contains the price. Never a container that holds the whole pricing table.
- If this page has no usage calculator, reply exactly: {"version":1,"control":null,"total":null}

Reply ONLY with the JSON object, no markdown, no surrounding text.
</task>

<format>
{"version":1,"control":{"selector":"#seats-slider","kind":"range","unit":"monthly tracked users","planName":null},"total":{"selector":".calc-total .amount"}}
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 512 });
  const result = safeParseJson(raw, CalculatorSpecSchema);
  if (!result.ok) {
    // The "no calculator here" sentinel parses as a schema miss (control: null),
    // which is the honest answer for a page the heuristics also failed on — the
    // caller caches nothing and the probe simply doesn't run again until the
    // page changes. Logged at the same level as generate-extractor's misses.
    console.error("generate-calculator-spec parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
