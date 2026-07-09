import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Carries, for the current async scope: (1) which pool provider actually served the
 * most recent `complete()` call, (2) which MODEL it actually ran, and (3) the token
 * usage accumulated by complete() calls — so the ai_runs logger can tag the real
 * provider (cerebras|groq|hyperbolic) and model instead of the static ones from
 * AI_CONFIG, AND attribute token cost per task (patch-22, patch-02 observability;
 * tokens added 2026-06, model added 2026-07).
 *
 * The model matters because AI_CONFIG.model is IGNORED on the pool path: callLLM
 * picks `provider.fastModel ?? provider.model` from the env-configured pool. Logging
 * AI_CONFIG.model recorded e.g. "llama-3.3-70b-versatile" for calls that really ran
 * `gpt-oss-120b` on Cerebras, so the /admin cost-per-task attribution was wrong.
 *
 * `complete()` calls `markProvider()` + `markModel()` + `markUsage()` after each
 * call; the job's logAiRun/loggedAi (or the API's logAskRun) — running in the same
 * async context — reads `getActiveProvider()`, `getActiveModel()` and
 * `consumeUsage()`. We use `enterWith` (not `run`) so the values escape the AI call
 * up to the caller's logging site. AI calls inside a run are sequential, so provider
 * and model are "last mark wins"; usage ACCUMULATES and is read-and-cleared by
 * `consumeUsage()`, so a multi-call task (e.g. classify + self-check, or ask's plan
 * + synthesis) sums correctly and the next log starts clean. Concurrent fan-out
 * within one run is not currently used.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface Scope {
  id: string | null;
  model: string | null;
  usage: TokenUsage;
}

const zeroUsage = (): TokenUsage => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });

const store = new AsyncLocalStorage<Scope>();

function scope(): Scope {
  let s = store.getStore();
  if (!s) {
    s = { id: null, model: null, usage: zeroUsage() };
    store.enterWith(s);
  }
  return s;
}

export function markProvider(id: string): void {
  scope().id = id;
}

export function getActiveProvider(): string | null {
  return store.getStore()?.id ?? null;
}

/** The model string actually sent to the provider (not AI_CONFIG's static one). */
export function markModel(model: string): void {
  scope().model = model;
}

export function getActiveModel(): string | null {
  return store.getStore()?.model ?? null;
}

/** Accumulate one `complete()` call's token usage into the current async scope. */
export function markUsage(u: TokenUsage): void {
  const s = scope();
  s.usage.promptTokens += u.promptTokens;
  s.usage.completionTokens += u.completionTokens;
  s.usage.totalTokens += u.totalTokens;
}

/**
 * Read AND clear the accumulated usage. Each ai_runs log point consumes the tokens
 * spent since the previous log point. Returns zeros when nothing ran in this scope
 * (e.g. a degraded pool, or a provider that returned no `usage`).
 */
export function consumeUsage(): TokenUsage {
  const s = store.getStore();
  if (!s) return zeroUsage();
  const used = s.usage;
  s.usage = zeroUsage();
  return used;
}
