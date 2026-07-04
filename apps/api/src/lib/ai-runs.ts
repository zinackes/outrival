import { aiRuns } from "@outrival/db";
import { getActiveProvider, consumeUsage } from "@outrival/ai";
import { db } from "./db";

export type AiRunStatus = "success" | "parse_failed" | "error";

// The API logs its OWN synchronous AI calls to ai_runs — the workers' loggedAi
// (apps/workers/src/lib/analytics.ts) is job-side only, so before this the API's
// in-request AI (onboarding analyze, ask) logged nothing and a Groq rate-limit there
// was invisible to /admin. Best-effort: a logging hiccup never breaks the request.
// Prefers the real pool provider captured by complete() in the same async context
// (patch-22); falls back to "groq" when the pool didn't run.
// Generic logger for any in-request API AI call. `task` is a free-text column, so
// new API-side tasks (ask, signals_brief, …) don't need a schema change.
export async function logApiAiRun(
  task: string,
  model: string,
  status: AiRunStatus,
): Promise<void> {
  try {
    const provider = getActiveProvider() ?? "groq";
    // Read-and-clear gives each row just this call's tokens.
    const usage = consumeUsage();
    await db.insert(aiRuns).values({
      task,
      provider,
      model,
      status,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    });
  } catch {
    // ai_runs is analytics, never load-bearing — swallow.
  }
}

export function logAskRun(model: string, status: AiRunStatus): Promise<void> {
  return logApiAiRun("ask", model, status);
}
