import { z } from "zod";
import { AI_CONFIG } from "../config";
import { groundedAiCall } from "../grounding/grounded-call";
import { attachQuality, type WithQuality } from "../grounding/types";

export const SummarySchema = z.object({
  summary: z.string(),
  category: z.string().optional(),
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
): Promise<WithQuality<CompetitorSummary> | null> {
  const signalsBlock = input.recentSignals.length
    ? input.recentSignals
        .slice(0, 8)
        .map((s) => `- [${s.severity}] ${s.category} — ${s.insight}`)
        .join("\n")
    : "No recent signals.";

  const reviewBlock = input.reviewSummary
    ? `Average score: ${input.reviewSummary.score ?? "n/a"}\nRecurring complaints: ${
        input.reviewSummary.topComplaints.length
          ? input.reviewSummary.topComplaints.join(", ")
          : "n/a"
      }`
    : "No review data.";

  const homepageBlock = input.homepageContent?.trim()
    ? input.homepageContent.trim().slice(0, 4000)
    : null;

  const prompt = `<competitor>
Name: ${input.name}
Category: ${input.category ?? "unknown"}
Description: ${input.description ?? "n/a"}
</competitor>

${homepageBlock ? `<homepage_content>\n${homepageBlock}\n</homepage_content>\n\n` : ""}<recent_signals>
${signalsBlock}
</recent_signals>

<reviews>
${reviewBlock}
</reviews>

<task>
Write an executive summary of this competitor in 2-3 factual sentences, and classify its market category.
- Informative tone, in English
- summary: what they do, where they sit, recent momentum. No superlatives, no speculation.
- category: the market segment this competitor operates in — 1-3 words, Title Case, in English
  (e.g. "CRM", "Project management", "Email marketing", "Observability", "Customer support").
  Derive it from the homepage content first, then the description and signals. ALWAYS commit to
  your best-guess segment even from sparse content — only return "" if there is genuinely no
  usable content at all (e.g. an empty page or a blocked/anti-bot shell).
- If page content (homepage_content) is provided, rely on it first to describe their offering, positioning and target
- Otherwise, if there are no recent signals, just state the product profile

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{ "summary": "Two to three factual sentences.", "category": "Market segment" }
</format>`;

  const sourceText = [homepageBlock ?? "", signalsBlock, reviewBlock].join("\n\n");
  const result = await groundedAiCall({
    taskName: "summarize_competitor",
    config: AI_CONFIG.classification,
    prompt,
    sourceText,
    schema: SummarySchema,
    maxTokens: 512,
  });
  return result ? attachQuality(result.output, result.quality) : null;
}
