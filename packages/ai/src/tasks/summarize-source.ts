import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

export const SourceSummarySchema = z.object({ summary: z.string() });
export type SourceSummary = z.infer<typeof SourceSummarySchema>;

interface PricingState {
  plan_name: string;
  price: number;
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
    };

function pricingBlock(plans: PricingState[]): string {
  return plans
    .map((p) => `- ${p.plan_name} : ${p.price} ${p.currency} / ${p.billing_period}`)
    .join("\n");
}

function buildContext(input: SourceSummaryInput): string {
  switch (input.kind) {
    case "pricing":
      return `<pricing_current>
${pricingBlock(input.current)}
</pricing_current>
<pricing_previous>
${input.previous && input.previous.length ? pricingBlock(input.previous) : "Première capture — aucune donnée antérieure."}
</pricing_previous>`;
    case "jobs":
      return `<hiring_current>
Total postes actifs : ${input.total}
Par département : ${input.departments.map((d) => `${d.department} ${d.count}`).join(", ") || "n/c"}
</hiring_current>
<hiring_delta>
${
        input.previousTotal === null
          ? "Première capture — aucune donnée antérieure."
          : `Total précédent : ${input.previousTotal}
Nouveaux postes (${input.added.length}) : ${input.added.slice(0, 10).join(", ") || "aucun"}
Postes fermés (${input.closed.length}) : ${input.closed.slice(0, 10).join(", ") || "aucun"}`
      }
</hiring_delta>`;
    case "reviews":
      return `<reviews_current>
Source : ${input.source}
Note : ${input.score ?? "n/c"} / 5 (${input.reviewCount ?? "n/c"} avis) · sentiment ${input.sentiment}/100
Points forts : ${input.praises.slice(0, 5).join(", ") || "n/c"}
Reproches : ${input.complaints.slice(0, 5).join(", ") || "n/c"}
</reviews_current>
<reviews_previous>
${input.previousScore === null ? "Première capture — aucune donnée antérieure." : `Note précédente : ${input.previousScore} / 5`}
</reviews_previous>`;
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
Rédige une synthèse factuelle de la dernière capture de cette source, en français, en 1-2 phrases courtes.
- Décris ce qui a été capturé (l'état actuel chiffré).
- Si des données antérieures sont fournies, indique ce qui a changé depuis (prix, nombre de postes, note…). Sinon, présente-le comme l'état initial.
- Pas de superlatifs, pas de spéculation, pas de recommandation.

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni texte autour.
</task>

<format>
{ "summary": "Une à deux phrases factuelles." }
</format>`;

  const raw = await complete(AI_CONFIG.classification, { prompt, json: true, maxTokens: 256 });
  const result = safeParseJson(raw, SourceSummarySchema);
  if (!result.ok) {
    console.error("Source summary parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
