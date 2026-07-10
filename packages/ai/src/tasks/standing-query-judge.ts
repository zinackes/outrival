import { z } from "zod";
import { AI_CONFIG } from "../config";
import { complete } from "../provider";

// Standing queries: when a re-evaluated Ask answer cites a DIFFERENT set of signals
// than the baseline, this light judge arbitrates "did the substance actually change,
// or is it the same picture told through different evidence?". Text is never diffed
// (the LLM rephrases freely) — the judge only runs after the cited-signal sets
// diverged. Pure task — the caller wraps it in loggedAi for ai_runs. Returns null on
// a parse failure (the caller then leaves the query's hysteresis state untouched).

export const StandingQueryJudgeSchema = z.object({
  materiallyChanged: z.boolean(),
  // One sentence for the alert body / digest row. Empty when nothing changed.
  changeSummary: z.string().default(""),
});
export type StandingQueryJudgement = z.infer<typeof StandingQueryJudgeSchema>;

export interface StandingQueryJudgeInput {
  question: string;
  baselineAnswer: string;
  freshAnswer: string;
  /** Insights of signals cited by the fresh answer but not the baseline. */
  addedSignals: string[];
  /** Insights of signals cited by the baseline but no longer by the fresh answer. */
  removedSignals: string[];
}

export function buildStandingQueryJudgePrompt(input: StandingQueryJudgeInput): string {
  const added =
    input.addedSignals.length > 0
      ? input.addedSignals.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "(none)";
  const removed =
    input.removedSignals.length > 0
      ? input.removedSignals.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "(none)";
  return `A user watches this competitive-intelligence question. The answer was recomputed
after new data arrived, and the set of evidence it cites has changed. Decide whether the
SUBSTANCE of the answer changed for the user — not the wording.

<question>
${input.question}
</question>

<previous_answer>
${input.baselineAnswer.slice(0, 3000)}
</previous_answer>

<new_answer>
${input.freshAnswer.slice(0, 3000)}
</new_answer>

<newly_cited_evidence>
${added}
</newly_cited_evidence>

<no_longer_cited_evidence>
${removed}
</no_longer_cited_evidence>

<rules>
- "materiallyChanged" is true ONLY if the new answer tells the user something
  actionably different: a new fact, a reversed conclusion, a meaningful shift in
  numbers, a new competitor move. Rewording, reordering, or restating the same
  facts through different evidence is NOT material.
- "changeSummary": if material, ONE factual sentence describing what changed
  (e.g. "Linear raised its Business plan from $12 to $16 per seat."). Empty string
  otherwise. Write all text values in English.
</rules>

Reply ONLY with a valid JSON object, no markdown and no surrounding text:
{ "materiallyChanged": true, "changeSummary": "..." }`;
}

export async function judgeStandingQuery(
  input: StandingQueryJudgeInput,
): Promise<StandingQueryJudgement | null> {
  const raw = await complete(AI_CONFIG.classificationFast, {
    prompt: buildStandingQueryJudgePrompt(input),
    json: true,
    maxTokens: 256,
  });
  try {
    const parsed = StandingQueryJudgeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
