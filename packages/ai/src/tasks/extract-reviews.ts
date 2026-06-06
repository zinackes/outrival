import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

// patch-32 — normalized sub-ratings. G2 ("Ease of Use", "Quality of Support"…) and
// Capterra ("Ease of Use", "Customer Service", "Features", "Value for Money") expose
// per-criterion scores out of 5; we fold both vocabularies onto this fixed set.
// Every field nullable: absent on pages that show only an overall rating.
export const ReviewSubScoresSchema = z.object({
  ease_of_use: z.number().min(0).max(5).nullable(),
  support: z.number().min(0).max(5).nullable(),
  features: z.number().min(0).max(5).nullable(),
  value: z.number().min(0).max(5).nullable(),
});
export type ReviewSubScores = z.infer<typeof ReviewSubScoresSchema>;

export const ReviewsSchema = z.object({
  average_score: z.number().nullable(),
  review_count: z.number().nullable(),
  sentiment_score: z.number().min(0).max(100),
  top_praises: z.array(z.string()).max(5),
  top_complaints: z.array(z.string()).max(5),
  // patch-32 — per-criterion ratings (null when the page shows none).
  sub_scores: ReviewSubScoresSchema.nullable().default(null),
  // patch-32 — the AI-judge pass: recurring complaint *themes* clustered from the
  // verbatims (a repeated grievance = a competitive opportunity), with how common
  // each is. Distinct from top_complaints (raw phrases) — these are deduped buckets.
  complaint_themes: z
    .array(
      z.object({
        theme: z.string(),
        prevalence: z.enum(["low", "medium", "high"]),
      }),
    )
    .max(5)
    .default([]),
});

export type ReviewsExtraction = z.infer<typeof ReviewsSchema>;

export async function extractReviews(reviewsPageText: string): Promise<ReviewsExtraction | null> {
  const prompt = `<reviews_page>
${reviewsPageText.slice(0, 10000)}
</reviews_page>

<task>
This page contains user reviews (G2, Capterra, App Store...).
Extract a structured summary. Write all text values in English.
- "average_score": average score out of 5 (e.g. 4.6), null if not found
- "review_count": total number of reviews, null if not found
- "sentiment_score": overall perceived tone from 0 (very negative) to 100 (very positive)
- "top_praises": 3-5 recurring strengths, in English, as short phrases
- "top_complaints": 3-5 recurring complaints, in English, as short phrases
- "sub_scores": per-criterion ratings out of 5 if the page shows them (G2/Capterra
  break the score into criteria). Map them onto: "ease_of_use", "support" (quality of
  support / customer service), "features", "value" (value for money). Use null for any
  criterion not shown. If the page shows no breakdown at all, set "sub_scores" to null.
- "complaint_themes": act as a judge over the complaint verbatims. Cluster recurring
  complaints into 0-5 distinct THEMES (deduped buckets, not raw phrases), each with a
  short English "theme" label and "prevalence" ("low" | "medium" | "high") reflecting how
  often it recurs. Empty array if there are no real complaints.
- Do not make things up if the info is missing — leave an empty array / null

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{
  "average_score": 4.5,
  "review_count": 1234,
  "sentiment_score": 78,
  "top_praises": ["Intuitive interface", "Responsive support"],
  "top_complaints": ["High price", "Lacks integrations"],
  "sub_scores": { "ease_of_use": 4.6, "support": 4.2, "features": 4.4, "value": 3.9 },
  "complaint_themes": [
    { "theme": "Pricing too high for small teams", "prevalence": "high" },
    { "theme": "Missing native integrations", "prevalence": "medium" }
  ]
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
