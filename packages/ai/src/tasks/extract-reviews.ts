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
This page contains user reviews (G2, Capterra, App Store...).
Extract a structured summary:
- "average_score": average score out of 5 (e.g. 4.6), null if not found
- "review_count": total number of reviews, null if not found
- "sentiment_score": overall perceived tone from 0 (very negative) to 100 (very positive)
- "top_praises": 3-5 recurring strengths, in English, as short phrases
- "top_complaints": 3-5 recurring complaints, in English, as short phrases
- Do not make things up if the info is missing — leave an empty array / null

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{
  "average_score": 4.5,
  "review_count": 1234,
  "sentiment_score": 78,
  "top_praises": ["Intuitive interface", "Responsive support"],
  "top_complaints": ["High price", "Lacks integrations"]
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
