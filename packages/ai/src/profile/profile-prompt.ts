/**
 * Shared prompt fragments for every product-profile extractor (live URL,
 * description, document, repo). Centralised on purpose: the four prompts used to
 * carry their own copy of the same `"category": "e.g. B2B SaaS / Productivity"`
 * format example, and an LLM anchors hard on that example — so any thin or
 * ambiguous page came back as generic "B2B SaaS" with a filler value prop, which
 * then poisoned competitor discovery. One source of truth here forces a specific,
 * functional answer and the diverse examples break single-vertical anchoring.
 *
 * The JSON skeleton deliberately uses descriptive placeholders (not a concrete
 * value) so the model has nothing to copy verbatim.
 */
export const PROFILE_FIELD_SPEC = `Fields:
- "category": the specific FUNCTIONAL category — what kind of product or service
  this is, defined by what it actually does. Name the real function, never the
  business model or delivery format. Do NOT answer "B2B SaaS", "mobile app",
  "platform", "software" or "tool". Good answers span every kind of business,
  e.g. "competitive-intelligence software", "appointment-scheduling tool",
  "freelance marketplace for designers", "meal-kit delivery service",
  "open-source API gateway".
- "audience": who specifically uses or buys it — a role plus its context, e.g.
  "RevOps teams at B2B SaaS scale-ups", "independent restaurant owners",
  "iOS developers shipping consumer apps".
- "whatItDoes": one to three sentences stating CONCRETELY what the product does —
  its real capabilities and how they work, grounded in the source. Factual and
  specific; no slogans, no adjectives without substance.
- "valueProp": ONE sentence naming the concrete job it does and the outcome for
  that audience. Ban filler such as "streamline your workflow", "boost
  productivity" or "all-in-one". Say what it concretely changes.
- "keywords": 4 to 8 short, concrete terms a buyer would actually search to find
  a product like this — the job to be done, capability names, category synonyms.
  No brand names, no bare words like "software", "platform" or "tool".
- "pricingModel": describe the pricing ONLY if the source mentions a price, plans,
  "free", "trial" or "subscription"; otherwise return "".
For any text field you cannot determine, return "" (or [] for keywords) — never
guess and never fall back to a generic label.`;

export const PROFILE_OUTPUT_RULES = `Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write every text value in English. If the source page is written in another
language, translate the values into English — never echo the source language.`;

export const PROFILE_FORMAT_BLOCK = `<format>
{
  "category": "<specific functional category>",
  "audience": "<who specifically uses it>",
  "whatItDoes": "<one to three concrete sentences>",
  "valueProp": "<one concrete sentence>",
  "keywords": ["<search term>", "<search term>"],
  "pricingModel": "<pricing, or empty string when the source shows none>"
}
</format>`;

/**
 * Assemble a profile prompt: a source block, a mode-specific intro line, the
 * shared field spec + output rules, and the shared format skeleton.
 */
export function buildProfilePrompt(sourceBlock: string, intro: string): string {
  return `${sourceBlock}

<task>
${intro}
${PROFILE_FIELD_SPEC}
${PROFILE_OUTPUT_RULES}
</task>

${PROFILE_FORMAT_BLOCK}`;
}
