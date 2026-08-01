import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

/**
 * Type a BATCH of changelog entries the keyword pass did not settle (Content
 * Intelligence v2 P1).
 *
 * The model is deliberately not allowed to say "breaking", "deprecation" or
 * "security". Those three are exactly the types that emit an alert, and they are
 * decided in code by `typeChangelogEntry` (@outrival/scrapers/content) before this
 * runs. What is left here is the distinction between shipping something new and
 * polishing something that existed, which changes a chart and wakes nobody up —
 * so a wrong answer costs a mislabelled row, never a false alarm.
 *
 * Batched at ~10 entries per call: release notes are short and independent, so a
 * fresh 40-entry feed costs four calls instead of forty.
 */

/** The types the model may choose. The alerting ones are not among them. */
export const TYPEABLE_ITEM_TYPES = ["feature", "improvement", "fix"] as const;

export const TypedContentItemSchema = z.object({
  /** Index into the batch passed in — ids are never sent, so they can't be mangled. */
  index: z.number().int(),
  item_type: z.enum(TYPEABLE_ITEM_TYPES),
  /** One line, in English, describing what the entry ships. */
  summary: z.string(),
  /**
   * A phrase copied from the entry. Substring-checked by the caller and dropped
   * when it isn't there — a row's quote has to be the publisher's words.
   */
  evidence_snippet: z.string().nullable().optional(),
});

export const TypedContentItemsSchema = z.object({
  items: z.array(TypedContentItemSchema),
});

export type TypedContentItem = z.infer<typeof TypedContentItemSchema>;
export type TypedContentItems = z.infer<typeof TypedContentItemsSchema>;

export interface ContentItemForTyping {
  title: string;
  body?: string | null;
}

/** How much of one entry the model sees. Release notes are short; posts are not. */
const MAX_ENTRY_CHARS = 1500;

export async function typeContentItems(
  batch: ReadonlyArray<ContentItemForTyping>,
): Promise<TypedContentItems | null> {
  if (batch.length === 0) return { items: [] };

  const docs = batch
    .map(
      (it, i) =>
        `<entry index="${i}">\n<title>${it.title}</title>\n<body>\n${(it.body ?? "").slice(
          0,
          MAX_ENTRY_CHARS,
        )}\n</body>\n</entry>`,
    )
    .join("\n\n");

  const prompt = `<changelog_entries>
${docs}
</changelog_entries>

<task>
You are reading a software company's release notes. For each entry, say what KIND
of change it is and summarise it in one line.

Kinds:
- "feature": something the product could not do before — a new capability, surface,
  integration or endpoint.
- "improvement": something that already existed, made faster, broader or nicer. A
  redesign, a performance gain, a raised limit, a new option on an existing feature.
- "fix": a defect corrected, a regression undone, a bug closed.

RULES — these decide whether your answer is usable:
- Return one entry per index given, and no index that was not given.
- "summary" is ONE sentence, at most 20 words, written in English even when the
  entry is not, and about what the entry says — never about how important it is.
- "evidence_snippet" MUST be copied WORD FOR WORD from that entry's title or body.
  Do not paraphrase it, do not translate it, do not join two sentences. A snippet
  that is not in the text is discarded.
- If you cannot quote the entry, set "evidence_snippet" to null rather than
  writing something close to it.
- When an entry is too thin to judge, call it "improvement" — it is the answer
  that claims the least.

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{
  "items": [
    {
      "index": 0,
      "item_type": "feature",
      "summary": "Adds webhook delivery retries with exponential backoff.",
      "evidence_snippet": "Webhooks are now retried up to five times."
    }
  ]
}
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 3072 });
  const result = safeParseJson(raw, TypedContentItemsSchema);
  if (!result.ok) {
    console.error("Content item typing parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
