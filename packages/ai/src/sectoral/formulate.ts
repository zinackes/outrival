import { z } from "zod";
import { AI_CONFIG } from "../config";
import { groundedAiCall } from "../grounding/grounded-call";
import { attachQuality, type WithQuality } from "../grounding/types";
import type { DetectedPattern } from "./types";

export const SectoralSignalDraftSchema = z.object({
  title: z.string().min(1),
  insight: z.string().min(1),
});

export type SectoralSignalDraft = z.infer<typeof SectoralSignalDraftSchema>;

export interface SectoralUserContext {
  category: string;
  audience: string;
}

// Turn a statistically-detected pattern into a readable signal. This is creative
// generation (not classification) → "smart" 70b model, no cache. The prompt is
// grounded strictly on the detector's evidence so the model cannot invent data.
export async function formulateSectoralSignal(
  pattern: DetectedPattern,
  userContext: SectoralUserContext,
): Promise<WithQuality<SectoralSignalDraft> | null> {
  const prompt = `You are a sector analyst writing for a company in the "${userContext.category || "software"}" space (audience: ${userContext.audience || "businesses"}).

A statistical detector found this trend across THEIR OWN tracked competitors:
<pattern>
${pattern.rawSignal}
</pattern>

<evidence>
${JSON.stringify(pattern.evidence, null, 2)}
</evidence>

<task>
Write a short, sober competitive-intelligence trend.
- "title": one factual line (no superlatives, no hype), e.g. "5 of 8 competitors shipped AI features this month".
- "insight": 2-3 sentences. State what the trend means for THIS company and one actionable "so what" (what they should consider doing).
- Use ONLY the numbers and competitors in the evidence. Do NOT invent data, competitors, dates, or predictions.
- Describe what IS happening, not what WILL happen. No forecasting.
- Write all text values in English.
Reply ONLY with valid JSON, no markdown.
</task>

<format>
{ "title": "...", "insight": "..." }
</format>`;

  const result = await groundedAiCall({
    taskName: "detect_sector_signals",
    config: AI_CONFIG.insights,
    prompt,
    sourceText: `${pattern.rawSignal}\n${JSON.stringify(pattern.evidence, null, 2)}`,
    schema: SectoralSignalDraftSchema,
    maxTokens: 512,
  });
  return result ? attachQuality(result.output, result.quality) : null;
}
