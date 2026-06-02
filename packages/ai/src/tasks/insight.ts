import { z } from "zod";
import { AI_CONFIG } from "../config";
import { groundedAiCall } from "../grounding/grounded-call";
import { attachQuality, type WithQuality } from "../grounding/types";
import type { Classification } from "./classify";

export const InsightSchema = z.object({
  insight: z.string(),
  so_what: z.string(),
  recommended_action: z.string().nullable(),
});

export type Insight = z.infer<typeof InsightSchema>;

export async function generateInsight(
  diffText: string,
  competitorName: string,
  competitorCategory: string | null,
  classification: Classification,
): Promise<WithQuality<Insight> | null> {
  const prompt = `<context>
Competitor: ${competitorName}
Product category: ${competitorCategory ?? "unknown"}
Change type: ${classification.category} (severity ${classification.severity})
</context>

<change>
${diffText.slice(0, 8000)}
</change>

<task>
Generate a strategic insight for this competitor change.
Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write all text values in English.
</task>

<format>
{
  "insight": "What happened, 1-2 factual sentences",
  "so_what": "Strategic implication for the user, 1-2 sentences",
  "recommended_action": "A concrete action, or null"
}
</format>`;

  const result = await groundedAiCall({
    taskName: "generate_signal",
    config: AI_CONFIG.insights,
    prompt,
    sourceText: diffText.slice(0, 8000),
    schema: InsightSchema,
  });
  return result ? attachQuality(result.output, result.quality) : null;
}
