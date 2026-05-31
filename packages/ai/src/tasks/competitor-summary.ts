import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

export const SummarySchema = z.object({
  summary: z.string(),
});

export type CompetitorSummary = z.infer<typeof SummarySchema>;

export interface CompetitorSummaryInput {
  name: string;
  category: string | null;
  description?: string | null;
  recentSignals: Array<{
    category: string;
    severity: string;
    insight: string;
  }>;
  reviewSummary?: {
    score: number | null;
    topComplaints: string[];
  };
  homepageContent?: string | null;
}

export async function generateCompetitorSummary(
  input: CompetitorSummaryInput,
): Promise<CompetitorSummary | null> {
  const signalsBlock = input.recentSignals.length
    ? input.recentSignals
        .slice(0, 8)
        .map((s) => `- [${s.severity}] ${s.category} — ${s.insight}`)
        .join("\n")
    : "Aucun signal récent.";

  const reviewBlock = input.reviewSummary
    ? `Note moyenne : ${input.reviewSummary.score ?? "n/c"}\nReproches récurrents : ${
        input.reviewSummary.topComplaints.length
          ? input.reviewSummary.topComplaints.join(", ")
          : "n/c"
      }`
    : "Pas de données reviews.";

  const homepageBlock = input.homepageContent?.trim()
    ? input.homepageContent.trim().slice(0, 4000)
    : null;

  const prompt = `<competitor>
Nom : ${input.name}
Catégorie : ${input.category ?? "inconnue"}
Description : ${input.description ?? "n/c"}
</competitor>

${homepageBlock ? `<homepage_content>\n${homepageBlock}\n</homepage_content>\n\n` : ""}<recent_signals>
${signalsBlock}
</recent_signals>

<reviews>
${reviewBlock}
</reviews>

<task>
Rédige un résumé exécutif en 2-3 phrases factuelles sur ce concurrent.
- Ton informatif, en français
- Inclure : ce qu'ils font, où ils se situent, dynamique récente
- Pas de superlatifs, pas de spéculation
- Si du contenu de page (homepage_content) est fourni, base-toi en priorité dessus pour décrire leur offre, leur positionnement et leur cible
- Sinon, si pas de signal récent, indique simplement le profil produit

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni texte autour.
</task>

<format>
{ "summary": "Deux à trois phrases factuelles." }
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 512 });
  const result = safeParseJson(raw, SummarySchema);
  if (!result.ok) {
    console.error("Competitor summary parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
