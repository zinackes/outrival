import { aiRuns } from "@outrival/db";
import {
  getActiveProvider,
  getActiveModel,
  consumeUsage,
  consumeAttempts,
  aiErrorKind,
} from "@outrival/ai";
import { db } from "./db";

export type AiRunStatus = "success" | "parse_failed" | "error";

// Best-effort owner of the spend (cost attribution, 2026-07 audit).
export interface AiRunAttribution {
  orgId?: string | null;
  competitorId?: string | null;
}

// The API logs its OWN synchronous AI calls to ai_runs — the workers' loggedAi
// (apps/workers/src/lib/analytics.ts) is job-side only, so before this the API's
// in-request AI (onboarding analyze, ask) logged nothing and a Groq rate-limit there
// was invisible to /admin. Best-effort: a logging hiccup never breaks the request.
// Prefers the real pool provider captured by complete() in the same async context
// (patch-22); falls back to "groq" when the pool didn't run.
// Generic logger for any in-request API AI call. `task` is a free-text column, so
// new API-side tasks (ask, signals_brief, …) don't need a schema change.
//
// MUST run inside withAiContext (established at the request handler / agent
// boundary) — Bun drops the lazy child-frame enterWith, so outside a context the
// reads below fall back to static labels and zero tokens.
export async function logApiAiRun(
  task: string,
  model: string,
  status: AiRunStatus,
  attribution?: AiRunAttribution,
  /** The throw behind an `error` row (see aiErrorKind). The interactive path is the
   *  one the audit found unprotected, so its failures need the same reason column the
   *  jobs get — otherwise a user-facing outage is invisible next to a worker one. */
  err?: unknown,
): Promise<void> {
  try {
    const provider = getActiveProvider() ?? "groq";
    // The pool picks the model (provider.fastModel ?? provider.model); the caller's
    // static AI_CONFIG.model never ran. Prefer what complete() actually sent.
    const actualModel = getActiveModel() ?? model;
    // Read-and-clear gives each row just this call's tokens.
    const usage = consumeUsage();
    // Same read-and-clear contract as the tokens: an uncleared count would leak into
    // the next request's row.
    const attempts = consumeAttempts();
    await db.insert(aiRuns).values({
      task,
      provider,
      model: actualModel,
      status,
      errorKind: status === "error" ? aiErrorKind(err) : "",
      attempts,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      orgId: attribution?.orgId ?? null,
      competitorId: attribution?.competitorId ?? null,
    });
  } catch {
    // ai_runs is analytics, never load-bearing — swallow.
  }
}

export function logAskRun(
  model: string,
  status: AiRunStatus,
  attribution?: AiRunAttribution,
  err?: unknown,
): Promise<void> {
  return logApiAiRun("ask", model, status, attribution, err);
}
