import { z } from "zod";
import { withAiCache } from "@outrival/shared";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

const CACHE_TTL_SECONDS = Number(process.env.AI_CACHE_TTL_CLASSIFY_DAYS ?? 7) * 86400;

export const ClassificationSchema = z.object({
  category: z.enum(["pricing", "product", "hiring", "reviews", "content", "funding"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  is_significant: z.boolean(),
  reason: z.string(),
  // Plain-language before/after of the main change, for the "Why this insight?"
  // panel (patch-14). nullable+optional so: (a) the model may return null when it
  // can't extract a clean pair, and (b) pre-patch cached classifications that lack
  // the keys still parse — withAiCache returns the stored object without
  // re-validating, so the cache key (diff hash) is unchanged and stays compatible.
  humanChangeBefore: z.string().nullable().optional(),
  humanChangeAfter: z.string().nullable().optional(),
});

export type Classification = z.infer<typeof ClassificationSchema>;

export async function classifyChange(diffText: string): Promise<Classification | null> {
  const prompt = `You are a competitive-intelligence analyst. Classify this change detected on a competitor.

<change>
${diffText.slice(0, 8000)}
</change>

<task>
Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write all text values in English.

Also identify the single MAIN change and describe it in plain language:
  - humanChangeBefore: the value BEFORE, phrased naturally (e.g. "Standard · $99/mo")
  - humanChangeAfter:  the value AFTER, phrased naturally (e.g. "Standard · $79/mo")
Keep each side short (a few words). If you can't extract a clean before/after,
return null for BOTH fields.
</task>

<format>
{
  "category": "pricing|product|hiring|reviews|content|funding",
  "severity": "low|medium|high|critical",
  "is_significant": true|false,
  "reason": "one short sentence",
  "humanChangeBefore": "Standard · $99/mo" or null,
  "humanChangeAfter": "Standard · $79/mo" or null
}
</format>`;

  const { value } = await withAiCache(
    diffText,
    { namespace: "classify", ttlSeconds: CACHE_TTL_SECONDS },
    async () => {
      const raw = await complete(AI_CONFIG.classificationFast, { prompt, json: true });
      const result = safeParseJson(raw, ClassificationSchema);
      if (!result.ok) {
        console.error("Classification parse failed:", result.error, "raw:", raw.slice(0, 500));
        return null;
      }
      return result.value;
    },
  );
  return value;
}
