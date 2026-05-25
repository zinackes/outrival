import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

export const ClassificationSchema = z.object({
  category: z.enum(["pricing", "product", "hiring", "reviews", "content", "funding"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  is_significant: z.boolean(),
  reason: z.string(),
});

export type Classification = z.infer<typeof ClassificationSchema>;

export async function classifyChange(diffText: string): Promise<Classification | null> {
  const prompt = `Tu es un analyste de veille concurrentielle. Classifie ce changement détecté chez un concurrent.

<change>
${diffText.slice(0, 8000)}
</change>

<task>
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni texte autour.
</task>

<format>
{
  "category": "pricing|product|hiring|reviews|content|funding",
  "severity": "low|medium|high|critical",
  "is_significant": true|false,
  "reason": "une phrase courte"
}
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true });
  const result = safeParseJson(raw, ClassificationSchema);
  if (!result.ok) {
    console.error("Classification parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
