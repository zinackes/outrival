import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

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
): Promise<BattleCardContent | null> {
  const signalsBlock = input.recentSignals.length
    ? input.recentSignals
        .slice(0, 8)
        .map((s) => `- [${s.severity}] ${s.category} — ${s.insight}`)
        .join("\n")
    : "Aucun signal récent.";

  const praisesBlock = input.reviewPraises.length
    ? input.reviewPraises.slice(0, 8).map((p) => `- ${p}`).join("\n")
    : "n/c";

  const complaintsBlock = input.reviewComplaints.length
    ? input.reviewComplaints.slice(0, 8).map((p) => `- ${p}`).join("\n")
    : "n/c";

  const prompt = `<my_product>
Catégorie : ${input.myProduct.category}
Proposition de valeur : ${input.myProduct.valueProp}
</my_product>

<competitor>
Nom : ${input.competitorName}
Résumé : ${input.competitorSummary ?? "inconnu"}
</competitor>

<reviews>
Ce que leurs clients adorent :
${praisesBlock}

Ce dont leurs clients se plaignent :
${complaintsBlock}
</reviews>

<recent_signals>
${signalsBlock}
</recent_signals>

<task>
Génère une battle card commerciale pour aider à gagner face à ce concurrent.
Sois concret, factuel, actionnable. Phrases courtes, en français.
- their_strengths : leurs vrais avantages (max 5)
- our_strengths : nos atouts face à eux (max 5)
- their_weaknesses : leurs vrais points faibles (max 5)
- common_objections : objections qu'un prospect pourrait soulever pour les choisir
  eux + ta réponse de vente (max 5)
- when_we_win : profils / contextes où on l'emporte (max 4)
- when_we_lose : profils / contextes où on perd (max 4)

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni texte autour.
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

  const raw = await complete(AI_CONFIG.insights, { prompt, json: true, maxTokens: 2048 });
  const result = safeParseJson(raw, BattleCardSchema);
  if (!result.ok) {
    console.error("Battle card parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
