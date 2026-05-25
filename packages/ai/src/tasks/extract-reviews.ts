import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

export const ReviewsSchema = z.object({
  average_score: z.number().nullable(),
  review_count: z.number().nullable(),
  sentiment_score: z.number().min(0).max(100),
  top_praises: z.array(z.string()).max(5),
  top_complaints: z.array(z.string()).max(5),
});

export type ReviewsExtraction = z.infer<typeof ReviewsSchema>;

export async function extractReviews(reviewsPageText: string): Promise<ReviewsExtraction | null> {
  const prompt = `<reviews_page>
${reviewsPageText.slice(0, 10000)}
</reviews_page>

<task>
Cette page contient des avis utilisateurs (G2, Capterra, App Store...).
Extrais une synthèse structurée :
- "average_score" : note moyenne sur 5 (ex: 4.6), null si introuvable
- "review_count" : nombre total d'avis, null si introuvable
- "sentiment_score" : ton ressenti global de 0 (très négatif) à 100 (très positif)
- "top_praises" : 3-5 points forts récurrents, en français, en phrases courtes
- "top_complaints" : 3-5 reproches récurrents, en français, en phrases courtes
- Ne pas inventer si l'info manque — laisser un tableau vide / null

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni texte autour.
</task>

<format>
{
  "average_score": 4.5,
  "review_count": 1234,
  "sentiment_score": 78,
  "top_praises": ["Interface intuitive", "Support réactif"],
  "top_complaints": ["Prix élevé", "Manque d'intégrations"]
}
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 1536 });
  const result = safeParseJson(raw, ReviewsSchema);
  if (!result.ok) {
    console.error("Reviews extraction parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
