/**
 * Ask Outrival mini-eval — replayable, deterministic assertions, no LLM judge.
 *
 * NOT a CI gate: it drives the REAL agent (live provider pool + dev DB), so it
 * costs tokens and needs keys. Run it manually before shipping any change to the
 * ask prompts, models, or tools:
 *
 *   set -a && . ./.env.local && set +a && \
 *     ASK_EVAL_ORG_ID=<dev-org-uuid> pnpm --filter @outrival/api eval:ask
 *
 * Pass gates (prompt-governance): refusal cases 100% — one parametric leak is a
 * fail; in-scope cases ≥ 80% answered/grounded.
 *
 * Checks per case:
 *   refusal          — answer matches a no-data/refusal pattern
 *   answered         — substantive answer (length + not a refusal)
 *   numbersGrounded  — every salient number in the answer appears in the tool
 *                      corpus re-fetched from the same org (numeric grounding)
 *   citationsPresent — at least one Sources citation came back
 */
import { GOLDEN } from "./golden";
import { runAskAgent, type AskEvent } from "../../src/lib/ask/agent";
import { getAskTool } from "../../src/lib/ask/tools";

const ORG_ID = process.env.ASK_EVAL_ORG_ID;
if (!ORG_ID) {
  console.error("Set ASK_EVAL_ORG_ID to a dev org uuid (an org with >= 2 competitors).");
  process.exit(2);
}

const REFUSAL =
  /\b(no data|not (?:enough|available)|couldn't|cannot|can't|don't have|isn't (?:any )?data|not tracked|unable to)\b/i;

// Salient numbers only (>= 2 digits or currency-prefixed) — "3 sentences" isn't a leak.
function numbersIn(text: string): string[] {
  return [...text.matchAll(/(?:[$€£]\s?\d[\d,.]*|\b\d{2,}[\d,.]*\b)/g)].map((m) =>
    m[0].replace(/[,\s$€£]/g, ""),
  );
}

const roster = (await getAskTool("listCompetitors")!.run(ORG_ID, {})) as {
  competitors: Array<{ id: string; name: string }>;
};
const [c1, c2] = roster.competitors;
if (!c1 || !c2) {
  console.error("The eval org needs at least 2 competitors.");
  process.exit(2);
}

// Ground-truth corpus for the number checks: every competitor-keyed tool result,
// serialized. Fetched once — drift between the agent's fetch and this one is
// negligible at eval cadence.
const corpusParts: string[] = [];
for (const tool of [
  "getSignals",
  "getPricingHistory",
  "getJobTrends",
  "getReviewThemes",
  "getTechStackChanges",
  "getCompetitorProfile",
]) {
  for (const comp of [c1, c2]) {
    corpusParts.push(
      JSON.stringify(await getAskTool(tool)!.run(ORG_ID, { competitorId: comp.id })),
    );
  }
}
const corpus = corpusParts.join(" ").replace(/[,\s]/g, "");

let pass = 0;
const failures: string[] = [];

for (const g of GOLDEN) {
  const question = g.question.replaceAll("{{C1}}", c1.name).replaceAll("{{C2}}", c2.name);
  let answer = "";
  let citations: Array<{ id: string }> = [];
  await runAskAgent(ORG_ID, "ask-eval", question, null, (ev: AskEvent) => {
    if (ev.type === "answer") {
      answer = ev.answer;
      citations = ev.citations;
    }
  });

  const isRefusal = REFUSAL.test(answer);
  const checks: Array<[string, boolean]> = [];
  if (g.expect.refusal) checks.push(["refusal", isRefusal]);
  if (g.expect.answered) checks.push(["answered", answer.length > 40 && !isRefusal]);
  if (g.expect.numbersGrounded) {
    const leaked = numbersIn(answer).filter((n) => !corpus.includes(n));
    checks.push(["numbers grounded", leaked.length === 0]);
  }
  if (g.expect.citationsPresent) checks.push(["citations present", citations.length > 0]);

  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length === 0) {
    pass++;
    console.log(`PASS ${g.id}`);
  } else {
    failures.push(`${g.id} [${failed.join(", ")}] — "${answer.slice(0, 160)}"`);
    console.log(`FAIL ${g.id} (${failed.join(", ")})`);
  }
}

console.log(`\n${pass}/${GOLDEN.length} passed`);
if (failures.length > 0) {
  console.log(failures.join("\n"));
  process.exit(1);
}
