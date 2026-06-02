import { z } from "zod";
import { AI_CONFIG } from "../config";
import { groundedAiCall } from "../grounding/grounded-call";
import { attachQuality, type WithQuality } from "../grounding/types";

export const BattleCardSchema = z.object({
  their_strengths: z.array(z.string()).max(5),
  our_strengths: z.array(z.string()).max(5),
  their_weaknesses: z.array(z.string()).max(5),
  common_objections: z
    .array(
      z.object({
        objection: z.string(),
        response: z.string(),
      }),
    )
    .max(5),
  when_we_win: z.array(z.string()).max(4),
  when_we_lose: z.array(z.string()).max(4),
});

export type BattleCardContent = z.infer<typeof BattleCardSchema>;

export interface BattleCardInput {
  myProduct: { category: string; valueProp: string };
  competitorName: string;
  competitorSummary: string | null;
  reviewComplaints: string[];
  reviewPraises: string[];
  recentSignals: Array<{ category: string; severity: string; insight: string }>;
}

export async function generateBattleCard(
  input: BattleCardInput,
): Promise<WithQuality<BattleCardContent> | null> {
  const signalsBlock = input.recentSignals.length
    ? input.recentSignals
        .slice(0, 8)
        .map((s) => `- [${s.severity}] ${s.category} — ${s.insight}`)
        .join("\n")
    : "No recent signals.";

  const praisesBlock = input.reviewPraises.length
    ? input.reviewPraises.slice(0, 8).map((p) => `- ${p}`).join("\n")
    : "n/a";

  const complaintsBlock = input.reviewComplaints.length
    ? input.reviewComplaints.slice(0, 8).map((p) => `- ${p}`).join("\n")
    : "n/a";

  const prompt = `<my_product>
Category: ${input.myProduct.category}
Value proposition: ${input.myProduct.valueProp}
</my_product>

<competitor>
Name: ${input.competitorName}
Summary: ${input.competitorSummary ?? "unknown"}
</competitor>

<reviews>
What their customers love:
${praisesBlock}

What their customers complain about:
${complaintsBlock}
</reviews>

<recent_signals>
${signalsBlock}
</recent_signals>

<task>
Generate a sales battle card to help win against this competitor.
Be concrete, factual, actionable. Short sentences, in English.
- their_strengths: their real advantages (max 5)
- our_strengths: our edge against them (max 5)
- their_weaknesses: their real weak points (max 5)
- common_objections: objections a prospect might raise to pick them
  + your sales response (max 5)
- when_we_win: profiles / contexts where we win (max 4)
- when_we_lose: profiles / contexts where we lose (max 4)

Reply ONLY with a valid JSON object, no markdown and no surrounding text.
</task>

<format>
{
  "their_strengths": ["..."],
  "our_strengths": ["..."],
  "their_weaknesses": ["..."],
  "common_objections": [{ "objection": "...", "response": "..." }],
  "when_we_win": ["..."],
  "when_we_lose": ["..."]
}
</format>`;

  // Ground the card against the real inputs we fed it (summary + reviews + signals),
  // so cited "their strength / weakness" claims must trace back to evidence.
  const sourceText = [
    input.competitorSummary ?? "",
    `What their customers love:\n${praisesBlock}`,
    `What their customers complain about:\n${complaintsBlock}`,
    `Recent signals:\n${signalsBlock}`,
  ].join("\n\n");

  const result = await groundedAiCall({
    taskName: "generate_battle_card",
    config: AI_CONFIG.insights,
    prompt,
    sourceText,
    schema: BattleCardSchema,
    maxTokens: 2048,
  });
  return result ? attachQuality(result.output, result.quality) : null;
}
