import { z } from "zod";
import { complete } from "../provider";
import { AI_CONFIG } from "../config";
import { safeParseJson } from "../lib/parse";

export const DigestSchema = z.object({
  temperature: z.enum(["calme", "modérée", "agitée"]),
  tldr: z.array(z.string()).max(3),
  sections: z.array(
    z.object({
      urgency: z.enum(["action_required", "watch", "fyi"]),
      competitor: z.string(),
      category: z.string(),
      insight: z.string(),
      so_what: z.string(),
    }),
  ),
});

export type Digest = z.infer<typeof DigestSchema>;

export interface DigestInputSignal {
  competitor: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  insight: string;
  so_what: string | null;
}

export async function generateDigest(
  signals: DigestInputSignal[],
): Promise<Digest | null> {
  const prompt = `<signals>
${JSON.stringify(signals, null, 2)}
</signals>

<task>
Génère un digest hebdomadaire de veille concurrentielle à partir de ces signaux.
- Évalue la température globale (calme/modérée/agitée)
- TL;DR : 3 points clés maximum
- Groupe les signaux : critical/high → action_required, medium → watch, low → fyi
Réponds UNIQUEMENT en JSON valide, sans markdown.
</task>

<format>
{
  "temperature": "calme|modérée|agitée",
  "tldr": ["point 1", "point 2", "point 3"],
  "sections": [
    { "urgency": "action_required|watch|fyi", "competitor": "...",
      "category": "...", "insight": "...", "so_what": "..." }
  ]
}
</format>`;

  const raw = await complete(AI_CONFIG.digest, { prompt, json: true, maxTokens: 2048 });
  const result = safeParseJson(raw, DigestSchema);
  if (!result.ok) {
    console.error("Digest parse failed:", result.error, "raw:", raw.slice(0, 500));
    return null;
  }
  return result.value;
}
