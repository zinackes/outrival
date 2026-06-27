import { z } from "zod";

// Ask Outrival — conversational intelligence over the org's own data. The AI half
// lives here and stays PURE (no DB): the API owns the org-scoped tool registry and
// passes each tool's serialisable spec in. Two passes: a FAST model PLANS which named
// tools to call (AskPlanSchema), the API runs them org-scoped, then a 70b model
// SYNTHESISES a grounded English answer over the results (AskAnswerSchema). No SQL
// ever leaves the model — it only picks tool names + arguments. See docs/ask-outrival.md.

// A tool as the planner sees it — no run handler (that's API-side, DB-bound).
export interface AskToolSpec {
  name: string;
  description: string;
  /** Human-readable param list, e.g. "competitorId (required), window (days, default 30)". */
  args: string;
}

// One competitor the model may reference by id. Name→id resolution happens in the
// plan, so "what changed at Linear" maps straight to the right id.
export interface AskRosterEntry {
  id: string;
  name: string;
}

export const AskPlanSchema = z.object({
  // Tool calls to run, in order. Empty = nothing to look up → the synthesis then
  // produces a grounded "no data" answer rather than guessing.
  calls: z
    .array(
      z.object({
        tool: z.string(),
        args: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(6)
    .default([]),
});
export type AskPlan = z.infer<typeof AskPlanSchema>;

// A citation the synthesis attaches — only ids that appeared in the tool results.
export const AskCitationSchema = z.object({
  type: z.enum(["competitor", "signal"]),
  id: z.string(),
  label: z.string(),
});
export const AskAnswerSchema = z.object({
  answer: z.string(),
  citations: z.array(AskCitationSchema).max(12).default([]),
});
export type AskAnswer = z.infer<typeof AskAnswerSchema>;

export function buildAskPlanPrompt(
  question: string,
  tools: AskToolSpec[],
  roster: AskRosterEntry[],
  context?: string,
): string {
  const toolList = tools.map((t) => `- ${t.name}(${t.args}) — ${t.description}`).join("\n");
  const rosterList =
    roster.length > 0
      ? roster.map((r) => `- ${r.name} → id "${r.id}"`).join("\n")
      : "(no competitors tracked yet)";
  return `You are the planner for "Ask Outrival", a competitive-intelligence assistant.
Decide which TOOLS to call to answer the user's question over their own tracked data.
You never write SQL — you only pick named tools and their arguments.

<tools>
${toolList}
</tools>

<competitors>
Resolve any competitor mentioned by name to its id using this list. If the question
names a competitor that is NOT in this list, omit that call.
${rosterList}
</competitors>
${
  context
    ? `
<context>
${context}
When the question is ambiguous about which competitor it concerns, prefer the one in
this context. The user's explicit wording always wins over this context.
</context>
`
    : ""
}
<question>
${question}
</question>

<rules>
- Return only the calls needed to answer; prefer the fewest (max 6).
- Pass competitor ids from the list above as arguments, never names.
- If the question cannot be answered from these tools, return an empty "calls" array.
</rules>

Reply ONLY with a JSON object, no markdown, no surrounding text:
{ "calls": [ { "tool": "getSignals", "args": { "window": 30 } } ] }`;
}

export function buildAskSynthesisPrompt(
  question: string,
  results: unknown,
  context?: string,
): string {
  return `You are "Ask Outrival", a competitive-intelligence analyst. Answer the user's
question using ONLY the tool results below — data already gathered from the user's own
tracked competitors. Write a concise, direct answer in English.

<question>
${question}
</question>
${context ? `\n<context>\n${context}\n</context>\n` : ""}
<tool_results>
${JSON.stringify(results, null, 2).slice(0, 12000)}
</tool_results>

<rules>
- Ground EVERY statement in the tool results. Do NOT invent numbers, dates, or facts.
- A competitor profile (category, description, AI summary, overlap) is enough to
  describe or compare competitors qualitatively. Use it even when there are no
  pricing, hiring, reviews, or signal metrics — only say "no data" when the results
  carry nothing at all about the competitors in question.
- If the results are empty or do not cover the question, say so plainly — never guess.
- Be specific: cite competitor names, figures, and dates that appear in the results.
- "citations": the competitor/signal ids you relied on (each MUST appear in the results).
- Write all text in English.
</rules>

Reply ONLY with a JSON object, no markdown, no surrounding text:
{ "answer": "...", "citations": [ { "type": "competitor", "id": "...", "label": "the competitor name" } ] }`;
}
