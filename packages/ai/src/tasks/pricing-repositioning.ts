import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";
import { InsightSchema, type Insight } from "./insight";
import type { PricingStatus, PricingRepositioningType } from "@outrival/shared";

export interface RepositioningInput {
  competitorName: string;
  competitorCategory: string | null;
  previous: PricingStatus;
  current: PricingStatus;
  type: PricingRepositioningType;
  diffText: string;
}

const STATUS_MEANINGS = `- public: prices fully visible
- public_partial: some tiers public, others sales-gated
- gated_demo: no prices, demo / sales contact required
- gated_signup: no prices, account signup required
- dynamic: usage-based / interactive calculator pricing`;

/**
 * Insight for a pricing *repositioning* (status transition), as opposed to a
 * raw diff. The model is told the before/after status so the "so what" speaks
 * to the strategic move, not the textual diff.
 */
export async function generateRepositioningInsight(
  input: RepositioningInput,
): Promise<Insight | null> {
  const prompt = `<context>
Competitor: ${input.competitorName}
Product category: ${input.competitorCategory ?? "unknown"}
Their pricing page repositioned: status moved from "${input.previous}" to "${input.current}" (transition: ${input.type}).
Pricing status meanings:
${STATUS_MEANINGS}
</context>

<change>
${input.diffText.slice(0, 4000)}
</change>

<task>
Explain this pricing repositioning and what it implies strategically for the
user (a competitor of this company). Focus on the status change, not the raw
text diff. Reply ONLY with a valid JSON object, no markdown and no surrounding
text. Write all text values in English.
</task>

<format>
{
  "insight": "What changed in their pricing strategy, 1-2 factual sentences",
  "so_what": "Strategic implication for the user, 1-2 sentences",
  "recommended_action": "A concrete action, or null"
}
</format>`;

  const raw = await complete(AI_CONFIG.insights, { prompt, json: true });
  const result = safeParseJson(raw, InsightSchema);
  if (!result.ok) {
    console.error("Repositioning insight parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
