/* eslint-disable no-console */
//
// Model-swap validation harness (optimization-audit #1). De-risks switching the
// SMART-tier default (AI_CONFIG.classification / .insights / .digest) from
// llama-3.3-70b-versatile to gpt-oss-120b — ~75% cheaper input + cacheable, but
// the prompts were tuned for Llama and gpt-oss is a reasoning model whose JSON
// adherence on Groq is documented as flaky. So we MEASURE, not guess.
//
// It replays the REAL prompts (the exported pure builders) for the two highest-
// volume smart tasks — generate_signal (insight) and classify_structured — against
// each candidate model, parses with the SAME safeParseJson + Zod schemas the
// pipeline uses, and reports the only things that decide the swap:
//   1. JSON/Zod pass rate   — the hard gate (does it produce a valid object?)
//   2. categorical agreement vs Llama (category/severity/is_significant) — safety
//   3. prompt/completion tokens + latency — empirical cost (completion INCLUDES
//      gpt-oss reasoning tokens, so reasoning_effort is tested low vs medium)
//
// It does NOT judge absolute quality (no labelled ground truth) — only whether the
// swap is SAFE (valid + comparable, cheaper). An LLM-judge pass is a future add.
//
// Run:  GROQ_API_KEY=… bun run packages/ai/src/eval/model-eval.ts
// Calls Groq directly (bypasses the pool/cache/grounding); reads only GROQ_API_KEY.

import OpenAI from "openai";
import { safeParseJson } from "../lib/parse";
import { InsightSchema, buildInsightPrompt } from "../tasks/insight";
import {
  buildStructuredClassifyPrompt,
  StructuredOutputSchema,
} from "../tasks/classify-structured";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const MAX_TOKENS = 1024; // must match the production default (provider.ts) to surface real truncation
// Free-tier Groq TPM limits are low (~8k tok/min/model). Pace calls so the eval
// doesn't 429 on itself; override with EVAL_PACING_MS.
const PACING_MS = Number(process.env.EVAL_PACING_MS ?? 2500);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface ModelSpec {
  id: string;
  model: string;
  reasoningEffort?: "low" | "medium" | "high";
  // USD per 1M tokens (input / output), 2026 Groq list prices.
  rate: { in: number; out: number };
}

const MODELS: ModelSpec[] = [
  { id: "llama-3.3-70b (baseline)", model: "llama-3.3-70b-versatile", rate: { in: 0.59, out: 0.79 } },
  { id: "gpt-oss-120b @low", model: "openai/gpt-oss-120b", reasoningEffort: "low", rate: { in: 0.15, out: 0.6 } },
  { id: "gpt-oss-120b @medium", model: "openai/gpt-oss-120b", reasoningEffort: "medium", rate: { in: 0.15, out: 0.6 } },
];

type Task = "insight" | "classify";
interface EvalCase {
  task: Task;
  name: string;
  prompt: string;
}

// Representative fixtures spanning categories + a clear non-significant case.
const CASES: EvalCase[] = [
  {
    task: "insight",
    name: "pricing drop",
    prompt: buildInsightPrompt(
      "Pricing page: Standard plan changed from $99/mo to $79/mo and added a 14-day free trial.",
      "Acme Analytics",
      "analytics SaaS",
      { category: "pricing", severity: "high", is_significant: true, reason: "price cut" },
    ),
  },
  {
    task: "insight",
    name: "hiring spike",
    prompt: buildInsightPrompt(
      "Careers page: 12 new roles opened, 8 of them in 'AI / ML Engineering', 2 in 'Developer Relations'.",
      "Beta CRM",
      "CRM software",
      { category: "hiring", severity: "medium", is_significant: true, reason: "hiring surge" },
    ),
  },
  {
    task: "insight",
    name: "funding",
    prompt: buildInsightPrompt(
      "Homepage banner: 'We raised a $40M Series B led by Sequoia to accelerate our AI roadmap.'",
      "Gamma Security",
      "security platform",
      { category: "funding", severity: "high", is_significant: true, reason: "funding round" },
    ),
  },
  {
    task: "classify",
    name: "hero headline change (expect major/high)",
    prompt: buildStructuredClassifyPrompt(
      [
        {
          kind: "hero_headline_changed",
          field: "hero.headline",
          before: "Project management for teams",
          after: "AI-powered project intelligence",
        },
      ],
      { competitorName: "Acme Analytics", sourceType: "homepage" },
    ),
  },
  {
    task: "classify",
    name: "nav-only change (expect minor/low)",
    prompt: buildStructuredClassifyPrompt(
      [
        {
          kind: "navigation_changed",
          field: "nav",
          before: "Home, Pricing, Docs",
          after: "Home, Pricing, Docs, Blog",
        },
      ],
      { competitorName: "Beta CRM", sourceType: "homepage" },
    ),
  },
  {
    task: "classify",
    name: "pricing section added (expect major/high)",
    prompt: buildStructuredClassifyPrompt(
      [
        {
          kind: "section_added",
          field: "sections[pricing]",
          before: null,
          after: "New pricing section with 3 tiers: Starter, Pro, Enterprise",
        },
      ],
      { competitorName: "Gamma Security", sourceType: "homepage" },
    ),
  },
];

interface CallResult {
  zodOk: boolean;
  // An API/transport failure (e.g. 429 rate limit) — NOT a JSON-adherence failure.
  // Kept distinct so the verdict never blames the model for a rate limit.
  apiError: boolean;
  parseError: string | null;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  // categorical fields, for classify agreement (null when parse failed / not classify)
  fields: { category: string; severity: string; is_significant: boolean } | null;
}

// Resolve a Groq key: GROQ_API_KEY, else the pool's Groq provider slot
// (AI_PROVIDER_N whose base URL is groq.com) so the existing .env just works.
function resolveGroqKey(): string | null {
  if (process.env.GROQ_API_KEY?.trim()) return process.env.GROQ_API_KEY.trim();
  for (let i = 1; i <= 10; i++) {
    const base = process.env[`AI_PROVIDER_${i}_BASE_URL`] ?? "";
    const key = process.env[`AI_PROVIDER_${i}_API_KEY`]?.trim();
    if (key && base.includes("groq.com")) return key;
  }
  return null;
}

function client(): OpenAI {
  const apiKey = resolveGroqKey();
  if (!apiKey) {
    console.error(
      "No Groq key found (GROQ_API_KEY or an AI_PROVIDER_*_API_KEY on groq.com).\n" +
        "Run: GROQ_API_KEY=… bun run packages/ai/src/eval/model-eval.ts",
    );
    process.exit(1);
  }
  return new OpenAI({ apiKey, baseURL: GROQ_BASE_URL, maxRetries: 1 });
}

async function runCase(c: OpenAI, spec: ModelSpec, ev: EvalCase): Promise<CallResult> {
  const t0 = Date.now();
  let content = "";
  let promptTokens = 0;
  let completionTokens = 0;
  try {
    const res = await c.chat.completions.create({
      model: spec.model,
      messages: [{ role: "user", content: ev.prompt }],
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
      ...(spec.reasoningEffort ? { reasoning_effort: spec.reasoningEffort } : {}),
    });
    content = res.choices[0]?.message?.content ?? "";
    promptTokens = res.usage?.prompt_tokens ?? 0;
    completionTokens = res.usage?.completion_tokens ?? 0;
  } catch (err) {
    return {
      zodOk: false,
      apiError: true,
      parseError: `API error: ${err instanceof Error ? err.message : String(err)}`,
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - t0,
      fields: null,
    };
  }
  const latencyMs = Date.now() - t0;

  // Parse per task with the concrete schema (a union schema breaks inference).
  if (ev.task === "insight") {
    const parsed = safeParseJson(content, InsightSchema);
    return parsed.ok
      ? { zodOk: true, apiError: false, parseError: null, promptTokens, completionTokens, latencyMs, fields: null }
      : { zodOk: false, apiError: false, parseError: parsed.error, promptTokens, completionTokens, latencyMs, fields: null };
  }
  const parsed = safeParseJson(content, StructuredOutputSchema);
  if (!parsed.ok) {
    return { zodOk: false, apiError: false, parseError: parsed.error, promptTokens, completionTokens, latencyMs, fields: null };
  }
  return {
    zodOk: true,
    apiError: false,
    parseError: null,
    promptTokens,
    completionTokens,
    latencyMs,
    fields: {
      category: parsed.value.category,
      severity: parsed.value.severity,
      is_significant: parsed.value.is_significant,
    },
  };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function costPer1kUsd(spec: ModelSpec, promptTok: number, completionTok: number): number {
  return ((promptTok * spec.rate.in + completionTok * spec.rate.out) / 1e6) * 1000;
}

async function main(): Promise<void> {
  const c = client();
  console.log("\n=== Model-swap eval: smart tier (llama-3.3-70b → gpt-oss-120b) ===");
  console.log(
    `Cases: ${CASES.filter((x) => x.task === "insight").length} insight + ` +
      `${CASES.filter((x) => x.task === "classify").length} classify | ` +
      `max_tokens=${MAX_TOKENS}, response_format=json_object\n`,
  );

  // results[modelId][caseName] = CallResult
  const results = new Map<string, Map<string, CallResult>>();
  for (const spec of MODELS) {
    const byCase = new Map<string, CallResult>();
    for (const ev of CASES) {
      const r = await runCase(c, spec, ev);
      byCase.set(ev.name, r);
      const tag = r.zodOk ? "ok  " : r.apiError ? "api!" : "FAIL";
      process.stdout.write(`  [${tag}] ${spec.id} · ${ev.name}\n`);
      if (!r.zodOk) process.stdout.write(`         ↳ ${r.parseError}\n`);
      await sleep(PACING_MS);
    }
    results.set(spec.id, byCase);
  }

  // --- Summary table. Token/latency/cost means are over VALID responses only, so a
  //     429 (0 tokens) doesn't deflate the cost. "api!" counts surface separately. ---
  console.log(
    "\nMODEL".padEnd(28) + "ZOD".padEnd(7) + "api!".padEnd(6) + "PROMPT".padEnd(9) + "COMPL".padEnd(9) + "LAT".padEnd(9) + "~$/1k",
  );
  for (const spec of MODELS) {
    const rs = [...results.get(spec.id)!.values()];
    const ok = rs.filter((r) => r.zodOk);
    const apiErr = rs.filter((r) => r.apiError).length;
    const pTok = mean(ok.map((r) => r.promptTokens));
    const cTok = mean(ok.map((r) => r.completionTokens));
    const lat = mean(ok.map((r) => r.latencyMs));
    const cost = costPer1kUsd(spec, pTok, cTok);
    console.log(
      spec.id.padEnd(28) +
        `${ok.length}/${rs.length}`.padEnd(7) +
        String(apiErr).padEnd(6) +
        Math.round(pTok).toString().padEnd(9) +
        Math.round(cTok).toString().padEnd(9) +
        `${(lat / 1000).toFixed(1)}s`.padEnd(9) +
        `$${cost.toFixed(3)}`,
    );
  }

  // --- Categorical agreement vs baseline (classify cases) ---
  const baseline = MODELS[0]!;
  const baseByCase = results.get(baseline.id)!;
  const classifyCases = CASES.filter((x) => x.task === "classify");
  console.log(`\nCategorical agreement vs baseline (${classifyCases.length} classify cases):`);
  for (const spec of MODELS.slice(1)) {
    const byCase = results.get(spec.id)!;
    let cat = 0;
    let sev = 0;
    let sig = 0;
    let comparable = 0;
    for (const ev of classifyCases) {
      const b = baseByCase.get(ev.name)?.fields;
      const m = byCase.get(ev.name)?.fields;
      if (!b || !m) continue;
      comparable++;
      if (b.category === m.category) cat++;
      if (b.severity === m.severity) sev++;
      if (b.is_significant === m.is_significant) sig++;
    }
    console.log(
      `  ${spec.id.padEnd(24)} category ${cat}/${comparable}   severity ${sev}/${comparable}   is_significant ${sig}/${comparable}`,
    );
  }

  // --- Heuristic verdict per candidate. A 429/API error is INCONCLUSIVE, never a
  //     JSON-adherence failure — only a real Zod parse miss blocks. ---
  console.log("\nVerdict (heuristic — confirm by reading the failures above):");
  const baseOk = [...baseByCase.values()].filter((r) => r.zodOk);
  const baseCost = costPer1kUsd(baseline, mean(baseOk.map((r) => r.promptTokens)), mean(baseOk.map((r) => r.completionTokens)));
  for (const spec of MODELS.slice(1)) {
    const rs = [...results.get(spec.id)!.values()];
    const ok = rs.filter((r) => r.zodOk);
    const parseFails = rs.filter((r) => !r.zodOk && !r.apiError).length;
    const apiErr = rs.filter((r) => r.apiError).length;
    const cost = costPer1kUsd(spec, mean(ok.map((r) => r.promptTokens)), mean(ok.map((r) => r.completionTokens)));
    const cheaper = cost < baseCost;
    const verdict =
      parseFails > 0
        ? `BLOCKED (${parseFails} JSON-adherence failure${parseFails > 1 ? "s" : ""})`
        : cheaper
          ? "PILOT-WORTHY"
          : "REVIEW (not cheaper)";
    const note = apiErr > 0 ? `  [${apiErr} API/429 error(s) — re-run with higher EVAL_PACING_MS]` : "";
    console.log(`  ${spec.id.padEnd(24)} ${verdict}  (~$${cost.toFixed(3)}/1k vs baseline $${baseCost.toFixed(3)})${note}`);
  }
  console.log("");
}

// This file is a dedicated script (never imported by the package), so running it
// on load is correct — it only executes via `bun run src/eval/model-eval.ts`.
void main();
