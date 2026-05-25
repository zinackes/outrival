import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";
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
): Promise<Insight | null> {
  const prompt = `<context>
Concurrent : ${competitorName}
Catégorie produit : ${competitorCategory ?? "inconnue"}
Type de changement : ${classification.category} (sévérité ${classification.severity})
</context>

<change>
${diffText.slice(0, 8000)}
</change>

<task>
Génère un insight stratégique pour ce changement concurrent.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni texte autour.
</task>

<format>
{
  "insight": "Ce qui s'est passé, 1-2 phrases factuelles",
  "so_what": "Implication stratégique pour l'utilisateur, 1-2 phrases",
  "recommended_action": "Action concrète ou null"
}
</format>`;

  const raw = await complete(AI_CONFIG.insights, { prompt, json: true });
  const result = safeParseJson(raw, InsightSchema);
  if (!result.ok) {
    console.error("Insight parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
