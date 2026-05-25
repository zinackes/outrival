import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";
import type { ProductProfile } from "./analyze-product";

const ScoredSchema = z.object({
  scores: z.array(
    z.object({
      url: z.string(),
      overlap_score: z.number().min(0).max(100),
      reason: z.string(),
    }),
  ),
});

export interface Candidate {
  url: string;
  title: string;
  snippet: string;
}

export interface ScoredCandidate {
  url: string;
  overlapScore: number;
  reason: string;
}

export async function scoreOverlap(
  profile: ProductProfile,
  candidates: Candidate[],
): Promise<ScoredCandidate[]> {
  if (candidates.length === 0) return [];

  const prompt = `<my_product>
Catégorie : ${profile.category}
Audience : ${profile.audience}
Valeur : ${profile.valueProp}
Modèle : ${profile.pricingModel}
</my_product>

<candidates>
${JSON.stringify(candidates, null, 2)}
</candidates>

<task>
Pour chaque candidat, évalue son overlap concurrentiel avec mon produit (0-100).
Un overlap élevé = même audience, même problème résolu, même marché.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni texte autour.
</task>

<format>
{
  "scores": [
    { "url": "...", "overlap_score": 0-100, "reason": "une phrase" }
  ]
}
</format>`;

  const raw = await complete(AI_CONFIG.classification, {
    prompt,
    json: true,
    maxTokens: 2048,
  });
  const result = safeParseJson(raw, ScoredSchema);
  if (!result.ok) {
    console.error("Overlap scoring parse failed:", result.error, "raw:", raw.slice(0, 500));
    return candidates.map((c) => ({ url: c.url, overlapScore: 0, reason: "scoring failed" }));
  }

  const byUrl = new Map<string, { overlapScore: number; reason: string }>();
  for (const s of result.value.scores) {
    byUrl.set(s.url, { overlapScore: s.overlap_score, reason: s.reason });
  }

  return candidates.map((c) => {
    const scored = byUrl.get(c.url);
    return scored
      ? { url: c.url, overlapScore: scored.overlapScore, reason: scored.reason }
      : { url: c.url, overlapScore: 0, reason: "not scored" };
  });
}
