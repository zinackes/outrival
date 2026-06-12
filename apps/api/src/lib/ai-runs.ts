import { aiRuns } from "@outrival/db";
import { getActiveProvider } from "@outrival/ai";
import { db } from "./db";

export type AiRunStatus = "success" | "parse_failed" | "error";

// The API logs its OWN synchronous AI calls to ai_runs — the workers' loggedAi
// (apps/workers/src/lib/analytics.ts) is job-side only, so before this the API's
// in-request AI (onboarding analyze, ask) logged nothing and a Groq rate-limit there
// was invisible to /admin. Best-effort: a logging hiccup never breaks the request.
// Prefers the real pool provider captured by complete() in the same async context
// (patch-22); falls back to "groq" when the pool didn't run.
export async function logAskRun(model: string, status: AiRunStatus): Promise<void> {
  try {
    const provider = getActiveProvider() ?? "groq";
    await db.insert(aiRuns).values({ task: "ask", provider, model, status });
  } catch {
    // ai_runs is analytics, never load-bearing — swallow.
  }
}
