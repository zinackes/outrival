import { z } from "zod";
import { AI_CONFIG } from "../config";
import { complete } from "../provider";

// Patch-26: one-line summary of a batch of similar signals from the same
// competitor ("3 minor feature updates from Linear this week"). Pure task — the
// caller wraps it in loggedAi for ai_runs. Best-effort: returns null on a parse
// failure so the batch is still created (just without a summary).

const BatchSummarySchema = z.object({ summary: z.string() });

export interface BatchSummaryInput {
  competitorName: string;
  category: string;
  signals: Array<{ severity: string; insight: string }>;
}

export async function generateBatchSummary(input: BatchSummaryInput): Promise<string | null> {
  const list = input.signals
    .slice(0, 12)
    .map((s, i) => `${i + 1}. [${s.severity}] ${s.insight}`)
    .join("\n");

  const prompt = `<competitor>${input.competitorName}</competitor>
<category>${input.category}</category>
<changes>
${list}
</changes>

<task>
These ${input.signals.length} related changes were detected on the same competitor in
the ${input.category} area. Write ONE concise sentence that summarises them as a group
(e.g. "Shipped three minor feature updates"). Factual tone, no superlatives. Write in
English.

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{ "summary": "One concise sentence." }
</format>`;

  try {
    const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 256 });
    const parsed = BatchSummarySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.summary : null;
  } catch {
    return null;
  }
}
