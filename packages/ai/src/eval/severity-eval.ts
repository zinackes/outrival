/* eslint-disable no-console */
//
// Labelled severity eval (2026-07-10 audit item 2) — the ground-truth layer
// model-eval.ts explicitly lacks. Replays the REAL classifiers (classifyChange /
// classifyStructuredChanges, same prompts, same pool) over hand-labelled cases
// (severity-golden.ts: real prod diffs + synthetic criticals) and reports:
//
//   1. band accuracy      — severity within the accepted band   (gate: >= 80%)
//   2. category accuracy  — category in the accepted set        (gate: >= 85%)
//   3. over-alerting      — criticals outside a critical band   (gate: ZERO)
//   4. critical reach     — >= 1 synthetic critical case must actually yield
//                           "critical", else the band is dead code in practice
//
// Manual gate, NOT CI (live LLM calls): run before shipping any change to the
// classify prompts, the shared rubric (classify-shared.ts), or the models.
//
//   set -a && . ./.env.local && set +a && pnpm --filter @outrival/ai eval:severity
//
// Model-only by design: applySeverityGuard (apps/workers) is deterministic and
// unit-tested there; this measures what the MODEL decides.

import { classifyChange } from "../tasks/classify";
import { classifyStructuredChanges } from "../tasks/classify-structured";
import { SEVERITY_GOLDEN } from "./severity-golden";

// The classifiers cache on their INPUT (withAiCache) — a rubric change would not
// invalidate entries, so a cached run would silently evaluate the OLD prompt.
// Drop the Upstash creds so the (lazy — env is read at first use) redis facade
// no-ops → every case runs the live prompt, never a stale cache entry.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

async function main(): Promise<void> {
let bandOk = 0;
let categoryOk = 0;
let overAlerts = 0;
let criticalReached = 0;
let failedCalls = 0;
const lines: string[] = [];

for (const c of SEVERITY_GOLDEN) {
  const ctx = { sourceType: c.sourceType, competitorName: c.competitorName };
  const res =
    c.kind === "lexical"
      ? await classifyChange(c.diffText, ctx)
      : (await classifyStructuredChanges(c.changes, ctx))?.classification ?? null;

  if (!res) {
    failedCalls++;
    lines.push(`ERROR ${c.id}: classification returned null (parse miss)`);
    continue;
  }

  const sevOk = (c.expectSeverity as string[]).includes(res.severity);
  const catOk = (c.expectCategory as string[]).includes(res.category);
  if (sevOk) bandOk++;
  if (catOk) categoryOk++;
  if (res.severity === "critical" && !c.expectSeverity.includes("critical")) {
    overAlerts++;
    lines.push(`OVER-ALERT ${c.id}: critical on a [${c.expectSeverity}] case — "${res.reason}"`);
  }
  if (c.synthetic && res.severity === "critical") criticalReached++;

  const mark = sevOk && catOk ? "PASS" : "MISS";
  lines.push(
    `${mark} ${c.id}: got ${res.severity}/${res.category} — expected [${c.expectSeverity}]/[${c.expectCategory}]${
      sevOk ? "" : " ← severity"
    }${catOk ? "" : " ← category"}`,
  );
}

const n = SEVERITY_GOLDEN.length - failedCalls;
const syntheticN = SEVERITY_GOLDEN.filter((c) => c.synthetic).length;
console.log(lines.join("\n"));
console.log(`\n— severity eval over ${SEVERITY_GOLDEN.length} cases (${failedCalls} call failures) —`);
console.log(`band accuracy:     ${bandOk}/${n} (gate >= 80%)`);
console.log(`category accuracy: ${categoryOk}/${n} (gate >= 85%)`);
console.log(`over-alerts:       ${overAlerts} (gate: 0)`);
console.log(`critical reach:    ${criticalReached}/${syntheticN} synthetic criticals → critical (gate >= 1)`);

const pass =
  n > 0 &&
  bandOk / n >= 0.8 &&
  categoryOk / n >= 0.85 &&
  overAlerts === 0 &&
  criticalReached >= 1 &&
  failedCalls === 0;
console.log(pass ? "\nGATES: PASS" : "\nGATES: FAIL");
process.exit(pass ? 0 : 1);
}

void main();
