import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Carries, for the current async scope: (1) which pool provider actually served the
 * most recent `complete()` call, (2) which MODEL it actually ran, and (3) the token
 * usage accumulated by complete() calls — so the ai_runs logger can tag the real
 * provider (cerebras|cloudflare|groq|mistral) and model instead of the static ones from
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
  truncated: boolean;
  /** Someone is waiting on this call at a screen (see withAiContext). */
  interactive: boolean;
  /**
   * The scope this one was opened inside, so a truncation raised deep in a nested
   * call (a task's loggedAi inside a job's own span) is visible to the caller that
   * has to DECIDE about it. Only `truncated` propagates upward: provider, model and
   * usage are per-unit-of-attribution by design.
   */
  parent: Scope | null;
}

const zeroUsage = (): TokenUsage => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });

const store = new AsyncLocalStorage<Scope>();

function scope(): Scope {
  let s = store.getStore();
  if (!s) {
    s = {
      id: null,
      model: null,
      usage: zeroUsage(),
      truncated: false,
      interactive: false,
      parent: null,
    };
    store.enterWith(s);
  }
  return s;
}

/**
 * Establish the AI context in the CALLER's frame for the span of `fn`. Every
 * complete() call inside mutates this same scope object, so the log site that
 * follows the await still reads it. The lazy enterWith() above is NOT enough on
 * its own: Bun (the API runtime) drops an enterWith made in a child async frame,
 * and the Trigger.dev runtime restores context snapshots around instrumented
 * calls — both left getStore() undefined at the log site, so every prod ai_runs
 * row carried 0 tokens and a static model label. store.run() relies only on
 * downward propagation + in-place mutation, which every runtime honours, and
 * isolates concurrent flows (the API handles parallel requests in one process).
 * Wrap at the unit-of-attribution boundary: loggedAi, or a task-call + logAiRun
 * sequence. The enterWith fallback stays for unwrapped sites (works on plain
 * Node, degrades to zeros elsewhere — exactly the pre-fix behaviour).
 *
 * `interactive` marks a call someone is waiting on at a screen, so the pool lets it
 * draw on the share of each provider's per-minute budget that background work is
 * held back from (see provider/tpm-window). It is INHERITED by nested scopes: a job
 * a user is watching wraps its body once, and every loggedAi inside it is
 * interactive without threading a flag through each task. Defaults to false, which
 * is the right default for everything the hourly fan-out runs.
 */
export function withAiContext<T>(
  fn: () => Promise<T>,
  opts?: { interactive?: boolean },
): Promise<T> {
  const parent = store.getStore() ?? null;
  const interactive = parent?.interactive || (opts?.interactive ?? false);
  return store.run(
    { id: null, model: null, usage: zeroUsage(), truncated: false, interactive, parent },
    fn,
  );
}

/**
 * Run `fn` and report whether ANY model call inside it was cut off at its output
 * ceiling — nested `withAiContext` spans included (that is what the parent link is
 * for).
 *
 * The caller needs this because a truncation and a malformed reply are the same
 * symptom (a parse miss, a null) with opposite repairs: another attempt gets a
 * different roll of the dice on malformed JSON, and reproduces a truncation exactly,
 * since the prompt and the token budget are both unchanged. A job that cannot tell
 * them apart burns its whole retry budget on the one that was never going to work.
 */
export async function withTruncationReport<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; truncated: boolean }> {
  const parent = store.getStore() ?? null;
  const s: Scope = {
    id: null,
    model: null,
    usage: zeroUsage(),
    truncated: false,
    interactive: parent?.interactive ?? false,
    parent,
  };
  const value = await store.run(s, fn);
  return { value, truncated: s.truncated };
}

/** Whether the current async scope is a call someone is waiting on. */
export function isInteractive(): boolean {
  return store.getStore()?.interactive ?? false;
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
 * Record that a `complete()` call in this scope hit its output ceiling
 * (`finish_reason: "length"`). Sticky for the scope: a truncated reply is always
 * malformed JSON downstream, and "the model ran out of room" is a different repair
 * (raise maxTokens / shrink the envelope) from "the model wrote bad JSON". Without
 * it the only trace was a `SyntaxError: Unterminated string` in a worker log.
 */
export function markTruncated(): void {
  // Up the chain too: the span that owns the retry decision is usually two frames
  // above the call that ran out of room (job → loggedAi → complete).
  for (let s: Scope | null = scope(); s; s = s.parent) s.truncated = true;
}

/** Whether any `complete()` call in this scope was cut off at its output ceiling. */
export function wasTruncated(): boolean {
  return store.getStore()?.truncated ?? false;
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
