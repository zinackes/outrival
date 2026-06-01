import { z } from "zod";
import { withAiCache } from "@outrival/shared";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";
import type { ProductProfile } from "./analyze-product";

const CACHE_TTL_SECONDS = Number(process.env.AI_CACHE_TTL_SCORE_DAYS ?? 30) * 86400;

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
Category: ${profile.category}
Audience: ${profile.audience}
Value: ${profile.valueProp}
Model: ${profile.pricingModel}
</my_product>

<candidates>
${JSON.stringify(candidates, null, 2)}
</candidates>

<task>
For each candidate, rate its competitive overlap with my product (0-100).
High overlap = same audience, same problem solved, same market.
Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write the "reason" in English.
</task>

<format>
{
  "scores": [
    { "url": "...", "overlap_score": 0-100, "reason": "one sentence" }
  ]
}
</format>`;

  // Canonical key over both inputs — same product + same candidate set → cached.
  const cacheInput = JSON.stringify({ profile, candidates });

  const { value } = await withAiCache<ScoredCandidate[] | null>(
    cacheInput,
    { namespace: "score-overlap", ttlSeconds: CACHE_TTL_SECONDS },
    async () => {
      const raw = await complete(AI_CONFIG.classificationFast, {
        prompt,
        json: true,
        maxTokens: 2048,
      });
      const result = safeParseJson(raw, ScoredSchema);
      if (!result.ok) {
        console.error("Overlap scoring parse failed:", result.error, "raw:", raw.slice(0, 500));
        return null; // never cache a scoring failure
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
    },
  );

  return value ?? candidates.map((c) => ({ url: c.url, overlapScore: 0, reason: "scoring failed" }));
}
