import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

export const SourceSummarySchema = z.object({ summary: z.string() });
export type SourceSummary = z.infer<typeof SourceSummarySchema>;

interface PricingState {
  plan_name: string;
  price: number | null;
  currency: string;
  billing_period: string;
}

export type SourceSummaryInput =
  | {
      kind: "pricing";
      current: PricingState[];
      previous: PricingState[] | null;
    }
  | {
      kind: "jobs";
      departments: Array<{ department: string; count: number }>;
      total: number;
      added: string[];
      closed: string[];
      previousTotal: number | null;
    }
  | {
      kind: "reviews";
      source: string;
      score: number | null;
      reviewCount: number | null;
      sentiment: number;
      praises: string[];
      complaints: string[];
      previousScore: number | null;
      // patch-32 — optional enrichment surfaced in the summary when present.
      subScores?: { ease_of_use: number | null; support: number | null; features: number | null; value: number | null } | null;
      themes?: { theme: string; prevalence: "low" | "medium" | "high" }[];
    };

function pricingBlock(plans: PricingState[]): string {
  return plans
    .map((p) =>
      p.price === null
        ? `- ${p.plan_name}: quote-based / ${p.billing_period}`
        : `- ${p.plan_name}: ${p.price} ${p.currency} / ${p.billing_period}`,
    )
    .join("\n");
}

function buildContext(input: SourceSummaryInput): string {
  switch (input.kind) {
    case "pricing":
      return `<pricing_current>
${pricingBlock(input.current)}
</pricing_current>
<pricing_previous>
${input.previous && input.previous.length ? pricingBlock(input.previous) : "First capture — no prior data."}
</pricing_previous>`;
    case "jobs":
      return `<hiring_current>
Active postings: ${input.total}
By department: ${input.departments.map((d) => `${d.department} ${d.count}`).join(", ") || "n/a"}
</hiring_current>
<hiring_delta>
${
        input.previousTotal === null
          ? "First capture — no prior data."
          : `Previous total: ${input.previousTotal}
New postings (${input.added.length}): ${input.added.slice(0, 10).join(", ") || "none"}
Closed postings (${input.closed.length}): ${input.closed.slice(0, 10).join(", ") || "none"}`
      }
</hiring_delta>`;
    case "reviews": {
      const ss = input.subScores;
      const subLine =
        ss && (ss.ease_of_use ?? ss.support ?? ss.features ?? ss.value) != null
          ? `\nSub-scores /5: ease of use ${ss.ease_of_use ?? "n/a"}, support ${ss.support ?? "n/a"}, features ${ss.features ?? "n/a"}, value ${ss.value ?? "n/a"}`
          : "";
      const themeLine =
        input.themes && input.themes.length
          ? `\nRecurring complaint themes: ${input.themes.map((t) => `${t.theme} (${t.prevalence})`).join("; ")}`
          : "";
      return `<reviews_current>
Source: ${input.source}
Score: ${input.score ?? "n/a"} / 5 (${input.reviewCount ?? "n/a"} reviews) · sentiment ${input.sentiment}/100${subLine}
Strengths: ${input.praises.slice(0, 5).join(", ") || "n/a"}
Complaints: ${input.complaints.slice(0, 5).join(", ") || "n/a"}${themeLine}
</reviews_current>
<reviews_previous>
${input.previousScore === null ? "First capture — no prior data." : `Previous score: ${input.previousScore} / 5`}
</reviews_previous>`;
    }
  }
}

// One short narrative per monitored source, regenerated each scrape. Answers
// "what did this scrape capture, and what moved since last time" so a source tab
// is readable even on the first capture (no diff/signal exists yet).
export async function summarizeSource(
  input: SourceSummaryInput,
): Promise<SourceSummary | null> {
  const prompt = `${buildContext(input)}

<task>
Write a factual summary of this source's latest capture, in English, in 1-2 short sentences.
- Describe what was captured (the current state, with numbers).
- If prior data is provided, state what changed since (price, number of postings, score…). Otherwise present it as the initial state.
- No superlatives, no speculation, no recommendations.

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{ "summary": "One or two factual sentences." }
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 256 });
  const result = safeParseJson(raw, SourceSummarySchema);
  if (!result.ok) {
    console.error("Source summary parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
