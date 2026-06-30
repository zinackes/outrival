import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

// AI Visibility / "Share of Model" (docs/ai-visibility.md). Given the answer an LLM
// answer-engine (Perplexity, ChatGPT, …) produced for a buyer-intent prompt, decide —
// for a CLOSED list of known subjects (the org's self product + tracked competitors) —
// which ones the answer actually mentions, in what order, and whether as a cited
// source. The subject list is provided; the model only judges presence, it never
// invents identities. The worker maps the returned names back onto the roster by exact
// match, so a hallucinated name simply resolves to nothing.
export const AiVisibilityMentionSchema = z.object({
  // Echoes back one of the provided subject names (verbatim) so the worker can map it
  // to a competitor id. Names the model didn't recognise are dropped downstream.
  name: z.string(),
  mentioned: z.boolean(),
  // 1-based order of first mention in the answer (1 = named first). Null if absent.
  rank: z.number().int().positive().nullable(),
  // True when the subject appears as a linked/cited source, not just in prose.
  cited: z.boolean(),
  // Tone toward the subject in this answer, 0 (negative) - 100 (positive). Null if absent.
  sentiment: z.number().min(0).max(100).nullable(),
});
export type AiVisibilityMention = z.infer<typeof AiVisibilityMentionSchema>;

export const AiVisibilityExtractionSchema = z.object({
  mentions: z.array(AiVisibilityMentionSchema).max(50),
});
export type AiVisibilityExtraction = z.infer<typeof AiVisibilityExtractionSchema>;

export async function extractAiVisibility(
  answer: string,
  subjects: string[],
): Promise<AiVisibilityExtraction | null> {
  const prompt = `<answer_engine_response>
${answer.slice(0, 8000)}
</answer_engine_response>

<subjects>
${subjects.map((s) => `- ${s}`).join("\n")}
</subjects>

<task>
The response above was produced by an AI answer engine for a buyer's question.
For EACH subject in the list above (and ONLY those — do not add any other brand),
report how it appears in the response. Write all text values in English.
- "name": copy the subject name EXACTLY as written in the list
- "mentioned": true if the response names or clearly refers to this subject, else false
- "rank": if mentioned, the 1-based order of its FIRST mention among all brands in the
  answer (1 = mentioned first); null if not mentioned
- "cited": true if the subject appears as a linked/cited source (a URL or reference),
  not merely named in prose; false otherwise
- "sentiment": if mentioned, the tone toward this subject from 0 (negative) to 100
  (positive); null if not mentioned
Return one object per subject, even when "mentioned" is false. Do not invent brands
that are not in the subject list.

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{
  "mentions": [
    { "name": "Acme CRM", "mentioned": true, "rank": 1, "cited": true, "sentiment": 80 },
    { "name": "Your Product", "mentioned": false, "rank": null, "cited": false, "sentiment": null }
  ]
}
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 1536 });
  const result = safeParseJson(raw, AiVisibilityExtractionSchema);
  if (!result.ok) {
    console.error("AI visibility extraction parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
