import { z } from "zod";
import { AI_CONFIG } from "../config";
import { complete } from "../provider";

// Alert conditions (OUT-192): the user wrote "price drops below $50" or "adds SSO to
// the free tier", and every signal is checked against those sentences as it is created.
// The output is a set of condition ids, nothing more — the reason the feed shows quotes
// the user's own words back at them, so the model is never asked to phrase anything.
//
// Precision over recall, deliberately. A condition that fires on a signal it does not
// describe is the failure that makes users delete the rule and stop trusting the flag;
// a condition that stays quiet on a near-miss costs them one scroll. The prompt says so,
// and the caller drops any id that was not in the input set (models invent ids).
//
// Pure task — the caller wraps it in loggedAi for ai_runs. Returns null on a parse
// failure, and the caller then treats the signal as matching nothing rather than
// guessing, so a provider hiccup can never manufacture an alert.

export const AlertConditionMatchSchema = z.object({
  matchedIds: z.array(z.string()).default([]),
});
export type AlertConditionMatch = z.infer<typeof AlertConditionMatchSchema>;

export interface AlertConditionCandidate {
  id: string;
  /** The user's sentence, verbatim. */
  condition: string;
}

export interface MatchAlertConditionsInput {
  conditions: readonly AlertConditionCandidate[];
  competitorName: string;
  category: string;
  severity: string;
  insight: string;
  soWhat?: string | null;
  /** The plain-language before/after, when the pipeline extracted one. */
  changeBefore?: string | null;
  changeAfter?: string | null;
}

export function buildMatchAlertConditionsPrompt(input: MatchAlertConditionsInput): string {
  const conditions = input.conditions
    .map((c) => `- id: ${c.id}\n  condition: ${c.condition}`)
    .join("\n");
  const before = input.changeBefore?.trim();
  const after = input.changeAfter?.trim();
  const movement = before && after ? `\nWhat moved: "${before}" → "${after}"` : "";
  const soWhat = input.soWhat?.trim() ? `\nWhy it matters: ${input.soWhat.trim()}` : "";

  return `A user watches competitors and wrote the alert conditions below in their own words.
Decide which of them this new competitor signal actually satisfies.

<signal>
Competitor: ${input.competitorName}
Category: ${input.category}
Severity: ${input.severity}
What happened: ${input.insight}${movement}${soWhat}
</signal>

<conditions>
${conditions}
</conditions>

<rules>
- Return a condition id ONLY if the signal plainly satisfies that condition as written.
- If a condition names a threshold, a number, or a specific feature, the signal must
  show it. "Price drops below $50" does not match a price rising, a price dropping to
  $80, or a vague pricing-page edit with no figure.
- Same competitor, same topic, wrong direction is NOT a match.
- When you are unsure, leave the condition out. A missed match costs the user one
  scroll; a wrong one costs them their trust in every alert after it.
- Return an empty array when nothing matches. That is the normal answer.
- Use the ids exactly as given. Do not invent ids and do not return anything else.
</rules>

Reply ONLY with a valid JSON object, no markdown and no surrounding text:
{ "matchedIds": ["..."] }`;
}

export async function matchAlertConditions(
  input: MatchAlertConditionsInput,
): Promise<AlertConditionMatch | null> {
  if (input.conditions.length === 0) return { matchedIds: [] };

  const raw = await complete(AI_CONFIG.classificationFast, {
    prompt: buildMatchAlertConditionsPrompt(input),
    json: true,
    maxTokens: 256,
  });
  try {
    const parsed = AlertConditionMatchSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    // Models return ids that were never offered. Anything outside the input set is
    // dropped rather than trusted: a hallucinated id would flag a signal against a
    // condition the user cannot see, which is the one failure with no recovery.
    const offered = new Set(input.conditions.map((c) => c.id));
    return { matchedIds: parsed.data.matchedIds.filter((id) => offered.has(id)) };
  } catch {
    return null;
  }
}
