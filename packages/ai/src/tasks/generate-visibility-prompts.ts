import { z } from "zod";
import { AI_CONFIG } from "../config";
import { complete } from "../provider";

// Seed prompts for AI Visibility / "Share of Model". These are sent verbatim to LLM
// answer engines (Gemini/Perplexity), so they must read like what a real buyer TYPES
// INTO ChatGPT — natural-language, buyer-intent questions — NOT keyword search queries
// ("best X tools"). They must also be UN-BRANDED: naming a competitor in the prompt
// guarantees it shows up in the answer, so share-of-model would measure the question,
// not organic visibility. We spend one generative call per product at seed time; the result
// is persisted in ai_visibility_prompts, so a run never regenerates. `fallbackVisibility
// Prompts` is a deterministic, AI-free safety net used when the model errors or the
// profile is too thin.

export interface VisibilityPromptInput {
  // The user's own product name (e.g. "Outrival").
  selfName: string | null;
  // Specific functional category (e.g. "competitive-intelligence software").
  category: string | null;
  // Who buys/uses it (e.g. "product & marketing teams").
  audience: string | null;
  // One-sentence value proposition.
  valueProp: string | null;
  // Concrete capabilities (e.g. ["automated competitor monitoring", "weekly digests"]).
  features: string[];
  // Names of the tracked competitors, for comparison-intent prompts.
  competitorNames: string[];
}

// Route + UI enforce 3..200 chars per prompt; mirror it here so seeds are editable.
const MIN_LEN = 3;
const MAX_LEN = 200;

/** Trim, strip list numbering / wrapping quotes, drop the empty and out-of-range,
 *  dedupe case-insensitively, cap. Shared by the AI path and the fallback. */
function cleanPrompts(raw: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const p = r
      .trim()
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "") // leading bullet / "1." / "1)"
      .replace(/^["'“”]+|["'“”]+$/g, "") // wrapping quotes
      .trim();
    const key = p.toLowerCase();
    if (p.length < MIN_LEN || p.length > MAX_LEN || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= cap) break;
  }
  return out;
}

const GenSchema = z.object({ prompts: z.array(z.string()) });

// Mirrors the ai_runs status enum so the caller can log the true outcome: a value
// ("ok"), a genuine parse miss ("parse_failed"), or a hard API failure like a 429
// ("error") — instead of lumping the last two together. The caller keeps going with
// the deterministic fallback in every non-ok case, so "error" never crashes the job.
export type VisibilityPromptOutcome =
  | { status: "ok"; prompts: string[] }
  | { status: "parse_failed" }
  | { status: "error" };

/**
 * Generate buyer-intent prompts for a product using its full profile. Pure task —
 * the caller logs the outcome to ai_runs and falls back to `fallbackVisibilityPrompts`
 * on any non-ok status. Assumes the profile has something to anchor on (the caller
 * skips the call and goes straight to the fallback for a thin profile).
 */
export async function generateVisibilityPrompts(
  input: VisibilityPromptInput,
  count = 10,
): Promise<VisibilityPromptOutcome> {
  // competitorNames is intentionally NOT injected here: the prompts must stay un-branded,
  // and handing the model rival names invites it to leak them into the questions.
  const { selfName, category, audience, valueProp, features } = input;

  const profile = [
    selfName ? `Product name: ${selfName}` : null,
    category ? `Category: ${category}` : null,
    audience ? `Audience: ${audience}` : null,
    valueProp ? `Value proposition: ${valueProp}` : null,
    features.length ? `Capabilities: ${features.slice(0, 8).join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `<product>
${profile}
</product>

<task>
Generate ${count} distinct prompts a real buyer would TYPE INTO an AI assistant
(ChatGPT, Perplexity, Gemini) while researching this kind of product. We measure how
often the product and its competitors appear in the AI's answers, so the prompts must
mirror how people actually ask an AI — natural-language questions and requests, NOT
search-engine keyword queries.

Rules:
- Write full, natural questions/requests ("What's the best way to...", "Which tool
  can...", "I need software that..."). NEVER bare keyword phrases like "best X tools".
- CRITICAL — keep every prompt UN-BRANDED. These measure whether the AI names brands
  ON ITS OWN, so the question must NOT contain the product's name, a competitor's name,
  or ANY specific vendor. Naming a brand guarantees it appears in the answer and
  measures nothing. Ask category-level questions instead ("Which <category> is best for
  <audience>?", "What tool can <do the job>?").
- The ONLY allowed exception is at most ONE "What are the best alternatives to
  <product>?" prompt that names the product itself. NEVER name a competitor.
- Cover a mix of intents: discovering options, solving the concrete job (use the
  capabilities/value proposition), and asking for a recommendation for the specific
  audience — every one phrased as an un-branded category question.
- Ground every prompt in this product's category, audience and capabilities — be
  specific, never generic.
- Write everything in English. Each prompt under 200 characters.

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{ "prompts": ["<natural buyer question>", "<natural buyer question>"] }
</format>`;

  let rawText: string;
  try {
    rawText = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 700 });
  } catch {
    // API-level failure (429/5xx after the SDK's own retries, network) — a real error.
    return { status: "error" };
  }
  // The model answered; from here a bad payload is a parse miss, not an error.
  let obj: unknown;
  try {
    obj = JSON.parse(rawText);
  } catch {
    return { status: "parse_failed" };
  }
  const parsed = GenSchema.safeParse(obj);
  if (!parsed.success) return { status: "parse_failed" };
  const cleaned = cleanPrompts(parsed.data.prompts, count);
  return cleaned.length > 0 ? { status: "ok", prompts: cleaned } : { status: "parse_failed" };
}

/**
 * Deterministic, AI-free seed set. Richer than a single-field template: crosses
 * category × audience × capabilities × competitor names. Used when the AI call fails
 * or the profile is too thin. Never throws; returns [] only when there's nothing to
 * build on.
 */
export function fallbackVisibilityPrompts(
  input: VisibilityPromptInput,
  count = 10,
): string[] {
  const { selfName, category, audience, features, competitorNames } = input;
  const cat = category?.trim() || null;
  const aud = audience?.trim() || null;
  const out: string[] = [];

  if (cat && aud) out.push(`What is the best ${cat} for ${aud}?`);
  if (cat) {
    out.push(`Which ${cat} would you recommend?`);
    out.push(`What should I look for when choosing ${cat}?`);
  }
  for (const f of features.slice(0, 3)) {
    const feat = f.trim();
    // Keep the feature's original casing — lowercasing would mangle acronyms
    // (AI, API, CRM) that show up in feature phrases.
    if (feat) out.push(`Which tools offer ${feat}?`);
  }
  if (selfName) out.push(`What are the best alternatives to ${selfName}?`);
  // At most ONE self-anchored comparison — NEVER competitor-vs-competitor. A prompt that
  // names only rivals guarantees they appear in the answer without ever testing the self
  // product, so it measures nothing about organic visibility.
  if (selfName && competitorNames[0]) {
    out.push(`How does ${selfName} compare to ${competitorNames[0]}?`);
  }

  return cleanPrompts(out, count);
}
