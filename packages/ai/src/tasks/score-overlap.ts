import { z } from "zod";
import { AI_CONFIG } from "../config";
import { groundedAiCall } from "../grounding/grounded-call";
import { attachQuality, emptyQuality, type WithQuality } from "../grounding/types";
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
): Promise<WithQuality<ScoredCandidate[]>> {
  if (candidates.length === 0) return attachQuality<ScoredCandidate[]>([], emptyQuality("high"));

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

  const result = await groundedAiCall({
    taskName: "score_overlap",
    config: AI_CONFIG.classificationFast,
    prompt,
    sourceText: cacheInput,
    schema: ScoredSchema,
    maxTokens: 2048,
    cache: { input: cacheInput, namespace: "score-overlap", ttlSeconds: CACHE_TTL_SECONDS },
  });

  if (!result) {
    return attachQuality(
      candidates.map((c) => ({ url: c.url, overlapScore: 0, reason: "scoring failed" })),
      emptyQuality("low"),
    );
  }

  const byUrl = new Map<string, { overlapScore: number; reason: string }>();
  for (const s of result.output.scores) {
    byUrl.set(s.url, { overlapScore: s.overlap_score, reason: s.reason });
  }

  const scored = candidates.map((c) => {
    const hit = byUrl.get(c.url);
    return hit
      ? { url: c.url, overlapScore: hit.overlapScore, reason: hit.reason }
      : { url: c.url, overlapScore: 0, reason: "not scored" };
  });

  return attachQuality(scored, result.quality);
}
