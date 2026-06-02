import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Carries which pool provider actually served the most recent `complete()` call so
 * the worker's ai_runs logger can tag the real provider (cerebras|groq|hyperbolic)
 * instead of the static `"groq"` from AI_CONFIG (patch-22, patch-02 observability).
 *
 * `complete()` calls `markProvider()` after picking; the job's logAiRun/loggedAi —
 * running in the same async context — reads `getActiveProvider()`. We use
 * `enterWith` (not `run`) so the value escapes the AI call up to the caller's
 * logging site. AI calls inside a job run are sequential, so the last mark wins;
 * concurrent fan-out within one run is not currently used.
 */
const store = new AsyncLocalStorage<{ id: string | null }>();

export function markProvider(id: string): void {
  const ctx = store.getStore();
  if (ctx) {
    ctx.id = id;
  } else {
    store.enterWith({ id });
  }
}

export function getActiveProvider(): string | null {
  return store.getStore()?.id ?? null;
}
