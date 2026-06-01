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
</task>

<format>
{
  "category": "pricing|product|hiring|reviews|content|funding",
  "severity": "low|medium|high|critical",
  "is_significant": true|false,
  "reason": "one short sentence"
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
