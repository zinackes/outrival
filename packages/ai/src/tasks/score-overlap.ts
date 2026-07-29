import { z } from "zod";
import { normalizeDomain } from "@outrival/shared";
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
  /**
   * False when the model returned nothing usable for this candidate (call failed,
   * or the reply carried no row for it). The 0 that comes with it is the ABSENCE
   * of a score, not a judgement of "no overlap" — callers that persist the score
   * must skip these rather than write a zero over a real one.
   */
  scored: boolean;
}

export async function scoreOverlap(
  profile: ProductProfile,
  candidates: Candidate[],
): Promise<WithQuality<ScoredCandidate[]>> {
  if (candidates.length === 0) return attachQuality<ScoredCandidate[]>([], emptyQuality("high"));

  const prompt = `<my_product>
Category: ${profile.category}
Audience: ${profile.audience}
What it does: ${profile.whatItDoes?.trim() || profile.valueProp}
Value: ${profile.valueProp}
Keywords: ${(profile.keywords ?? []).join(", ")}
Model: ${profile.pricingModel}
</my_product>

<candidates>
${JSON.stringify(candidates, null, 2)}
</candidates>

<task>
For each candidate, rate its competitive overlap with my product against the
fixed scale below.

Score every candidate INDEPENDENTLY against that scale. Do not spread the
scores across the candidate list, and do not reserve the top band for the best
candidate in the list: a candidate scored alone must get the same number it
would get inside a list of thirty.

Judge what the candidate DOES, not how much text you were given about it.
Reply ONLY with a valid JSON object, no markdown and no surrounding text.
Write the "reason" in English.
</task>

<scale>
90-100: direct substitute. Same job, same buyer, a prospect picks one or the other.
70-89: same job for a different segment, packaging or go-to-market. Lands on the same shortlist.
40-69: partial overlap. One shared capability, or the same buyer with a different problem solved.
10-39: adjacent. Same market, never competing on a deal.
0-9: unrelated.
</scale>

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
    // One { url, score, reason } row per candidate: the pool now unions three
    // recall sources, so budget for the widened list instead of truncating the
    // JSON (a truncated reply parses to null → every candidate scored 0).
    maxTokens: 4096,
    // Namespace bumped with the anchored scale: `withAiCache` never revalidates a
    // stored entry, so entries written under the old free-form prompt would keep
    // serving spread-across-the-list scores for the whole 30-day TTL.
    cache: { input: cacheInput, namespace: "score-overlap-v2", ttlSeconds: CACHE_TTL_SECONDS },
  });

  if (!result) {
    return attachQuality(
      candidates.map((c) => ({
        url: c.url,
        overlapScore: 0,
        reason: "scoring failed",
        scored: false,
      })),
      emptyQuality("low"),
    );
  }

  // Match on normalized domain, not exact string: the LLM routinely rewrites the
  // URL it echoes back (drops the trailing slash, adds/strips www, http→https,
  // lowercases), which made `byUrl.get(c.url)` miss and silently score a real hit
  // as 0 ("not scored"). normalizeDomain ignores scheme/path/www on both sides.
  const byDomain = new Map<string, { overlapScore: number; reason: string }>();
  for (const s of result.output.scores) {
    const key = normalizeDomain(s.url);
    if (key) byDomain.set(key, { overlapScore: s.overlap_score, reason: s.reason });
  }

  const scored = candidates.map((c, i) => {
    const hit =
      byDomain.get(normalizeDomain(c.url) ?? "") ??
      // Positional fallback: same count in/out (e.g. the single-candidate recompute
      // path) → trust the LLM kept order even if the URL is unparseable.
      (result.output.scores.length === candidates.length
        ? (() => {
            const s = result.output.scores[i];
            return s ? { overlapScore: s.overlap_score, reason: s.reason } : undefined;
          })()
        : undefined);
    return hit
      ? { url: c.url, overlapScore: hit.overlapScore, reason: hit.reason, scored: true }
      : { url: c.url, overlapScore: 0, reason: "not scored", scored: false };
  });

  return attachQuality(scored, result.quality);
}
