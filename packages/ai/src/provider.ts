import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { AITaskConfig } from "./config";
import { aiEnv } from "./env";
import {
  loadProviders,
  pickProvider,
  trackUsage,
  tripBreaker,
  type Provider,
} from "./provider/provider-pool";
import {
  checkGlobalBreaker,
  recordFailure,
  recordSuccess,
  tripGlobalBreaker,
  AIUnavailableError,
} from "./provider/circuit-breaker";
import { markProvider, markUsage } from "./provider/provider-context";

// One OpenAI client per pool provider (Cerebras/Groq/Hyperbolic are all
// OpenAI-compatible, routed by baseURL). maxRetries lets the SDK absorb a transient
// 429/5xx before we fail over to the next provider.
const openaiClients = new Map<string, OpenAI>();
let claudeClient: Anthropic | null = null;

function clientFor(p: Provider): OpenAI {
  let c = openaiClients.get(p.id);
  if (!c) {
    c = new OpenAI({ apiKey: p.apiKey, baseURL: p.baseUrl, maxRetries: 2 });
    openaiClients.set(p.id, c);
  }
  return c;
}

function getClaude(): Anthropic {
  if (!claudeClient) {
    const key = aiEnv().ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is required when provider=claude");
    claudeClient = new Anthropic({ apiKey: key });
  }
  return claudeClient;
}

export interface CompletionOptions {
  prompt: string;
  maxTokens?: number;
  json?: boolean;
  /**
   * Static, byte-identical-across-calls instructions (role, rules, schema). Sent
   * as a separate `system` message so the variable payload stays in `prompt` at
   * the tail — Groq/Cerebras auto-cache the shared prefix for free, and the Claude
   * fallback marks it `cache_control: ephemeral` (F2). Omit to keep one user
   * message (today's behavior).
   */
  system?: string;
}

// A 429/5xx is transient. A per-provider 401/403/404 (bad key or missing model at
// THIS provider) is permanent for this provider, but the next one — different key
// and model — may still work, so fail over too. Only a 400 (a request WE built
// wrong) would hit every provider identically → fail fast.
function shouldFailover(err: unknown): boolean {
  if (!(err instanceof OpenAI.APIError)) return false;
  const s = err.status ?? 0;
  return s === 429 || s === 401 || s === 403 || s === 404 || s >= 500;
}

// 401/403/404 = bad key, wrong model id, or wrong base URL at THIS provider — an env
// mistake that won't self-heal by backing off (vs 429/5xx = transient infra distress).
// "404 status code (no body)" specifically is an OpenAI-SDK POST to a base URL whose
// /chat/completions route doesn't exist → almost always a base URL missing /v1. We still
// fail over (a 404 on provider A may work on B), but tag the exhaustion so the surfaced
// error and the breaker reason say "fix AI_PROVIDER_* env", not a generic outage.
// Exported for unit testing this diagnostic branch.
export function isConfigError(err: unknown): boolean {
  if (!(err instanceof OpenAI.APIError)) return false;
  const s = err.status ?? 0;
  return s === 401 || s === 403 || s === 404;
}

// gpt-oss models on Groq are reasoning models: without `reasoning_effort` they
// default to "medium", which roughly DOUBLES the completion tokens (hidden
// reasoning) for no quality/agreement gain on our extraction & classification
// prompts (validated: src/eval/model-eval.ts). Pin "low" for them; a provider may
// override via AI_PROVIDER_N_REASONING_EFFORT. Non-reasoning models (Llama) get
// NOTHING — the param is never sent, so their request is byte-identical to before.
// Exported for unit testing this cost-critical branch.
export function resolveReasoningEffort(
  model: string,
  override?: "low" | "medium" | "high",
): "low" | "medium" | "high" | undefined {
  if (!model.toLowerCase().includes("gpt-oss")) return undefined;
  return override ?? "low";
}

/**
 * Run a completion against the provider pool (patch-22). Picks the best available
 * provider (free before paid, skipping exhausted/breakered ones), and on a transient
 * failure trips that provider's breaker and fails over to the next — so a synchronous
 * caller (onboarding analyze, discovery) stays resilient without relying on a job
 * retry. Records the actual provider for ai_runs via markProvider, tracks token usage,
 * and trips the global breaker when every provider is down.
 */
async function callLLM(options: CompletionOptions, fast = false): Promise<string> {
  const breaker = await checkGlobalBreaker();
  if (breaker.open) throw new AIUnavailableError(breaker.reason ?? "ai_unavailable");

  const maxAttempts = Math.max(1, loadProviders().length);
  let lastErr: unknown;
  // Track WHY the pool was exhausted: a config-only wipe (every provider 401/403/404)
  // is an env mistake to surface loudly, not the transient infra distress the generic
  // "all_providers_failed / no_providers_available" message implies.
  let sawConfigError = false;
  let sawTransientError = false;
  // In-memory record of providers already tried THIS call. The per-provider breaker
  // (tripBreaker) only advances pickProvider to the next provider when it persists —
  // which needs Redis. Without Upstash that breaker is a no-op, so pickProvider would
  // keep returning the same top-priority provider every iteration and a broken
  // priority-1 provider would wedge the whole pool (the loop hits it N times, never
  // reaching a healthy lower-priority one). This local set makes failover progress
  // regardless of Redis: each picked provider is excluded from the next pick.
  const tried = new Set<string>();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const provider = await pickProvider(tried);
    if (!provider) break; // every provider exhausted, in breaker, or already tried
    tried.add(provider.id);
    markProvider(provider.id);
    // A "fast"-tier task (classify-change, overlap scoring) routes to the
    // provider's small 8B-class model when declared — ~10× cheaper than the 70B.
    // Falls back to the default model when the provider has no fast model.
    const model = fast && provider.fastModel ? provider.fastModel : provider.model;
    const reasoningEffort = resolveReasoningEffort(model, provider.reasoningEffort);
    try {
      const res = await clientFor(provider).chat.completions.create({
        model,
        // Static system prefix (when provided) before the variable user payload —
        // a byte-identical prefix lets Groq/Cerebras auto-cache the prefill (F2).
        messages: [
          ...(options.system
            ? [{ role: "system" as const, content: options.system }]
            : []),
          { role: "user", content: options.prompt },
        ],
        max_tokens: options.maxTokens ?? 1024,
        ...(options.json && { response_format: { type: "json_object" as const } }),
        // Only sent for reasoning models (gpt-oss) — never for Llama (undefined).
        ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
      });
      await trackUsage(provider.id, res.usage?.total_tokens ?? 0);
      // Accumulate per-task token usage for ai_runs cost attribution. Counted here
      // (with trackUsage) even on the empty-content failover below: those tokens
      // were spent, so the cost is real.
      markUsage({
        promptTokens: res.usage?.prompt_tokens ?? 0,
        completionTokens: res.usage?.completion_tokens ?? 0,
        totalTokens: res.usage?.total_tokens ?? 0,
      });
      const content = res.choices[0]?.message?.content ?? "";
      // A 200 with empty content is a failed generation, never a valid answer (every
      // prompt asks for JSON or prose). It happens when a reasoning model's hidden
      // reasoning eats the whole max_tokens budget before any answer, or on a silent
      // refusal. Treat it like a transient provider fault: trip THIS provider's
      // breaker and fail over to the next, instead of returning "" — which used to
      // surface as a hard "Empty completion" throw that failed the task without ever
      // trying another provider, taking down every AI task when the priority-1
      // provider was a reasoning one. Per-provider only: an empty 200 is provider
      // misbehaviour, not the infra distress the global breaker watches for, so it
      // must not count toward tripping it (recordFailure is intentionally skipped).
      if (!content.trim()) {
        await tripBreaker(provider.id, "empty_completion");
        lastErr = new Error(`empty completion from ${provider.id}`);
        continue;
      }
      await recordSuccess();
      return content;
    } catch (err) {
      if (shouldFailover(err)) {
        const rateLimited = err instanceof OpenAI.APIError && err.status === 429;
        if (isConfigError(err)) sawConfigError = true;
        else sawTransientError = true;
        await tripBreaker(provider.id, rateLimited ? "rate_limited" : "provider_error");
        await recordFailure(provider.id);
        lastErr = err;
        continue;
      }
      throw err; // real error — fail fast, don't churn the pool
    }
  }

  // Config-only exhaustion (every provider rejected with 401/403/404, no transient
  // fault): the pool is misconfigured, not down. Make the error and the ops ping
  // actionable so it reads as "fix the env" instead of a generic provider outage.
  const misconfigured = sawConfigError && !sawTransientError;
  await tripGlobalBreaker(misconfigured ? "ai_provider_misconfigured" : "no_providers_available");
  if (misconfigured) {
    const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new AIUnavailableError(
      `ai_provider_misconfigured: every provider rejected the request (last: ${detail}). ` +
        `Check AI_PROVIDER_*_BASE_URL (needs a trailing /v1) and AI_PROVIDER_*_MODEL.`,
    );
  }
  throw new AIUnavailableError(
    lastErr instanceof Error ? `all_providers_failed: ${lastErr.message}` : "no_providers_available",
  );
}

async function dispatch(
  config: AITaskConfig,
  options: CompletionOptions,
): Promise<string> {
  if (config.provider === "groq") {
    // "groq" now means "the provider pool". A "fast"-tier task routes to the
    // provider's small model (AI_PROVIDER_N_FAST_MODEL) when declared, restoring
    // the 8b/70b split the pool had collapsed; "smart" tasks keep the 70B.
    return callLLM(options, config.tier === "fast");
  }

  if (config.provider === "claude") {
    markProvider("claude");
    const res = await getClaude().messages.create({
      model: config.model,
      max_tokens: options.maxTokens ?? 1024,
      // Mark the static system block ephemeral so Anthropic caches the prefill
      // (~90% off on a hit) when the same task fires repeatedly (F2).
      ...(options.system && {
        system: [
          {
            type: "text" as const,
            text: options.system,
            cache_control: { type: "ephemeral" as const },
          },
        ],
      }),
      messages: [{ role: "user", content: options.prompt }],
    });
    const inputTokens = res.usage?.input_tokens ?? 0;
    const outputTokens = res.usage?.output_tokens ?? 0;
    markUsage({
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    });
    const block = res.content[0];
    return block && block.type === "text" ? block.text : "";
  }

  throw new Error(`Unknown AI provider: ${config.provider as string}`);
}

export async function complete(
  config: AITaskConfig,
  options: CompletionOptions,
): Promise<string> {
  const text = await dispatch(config, options);
  // An empty completion is a failed generation (rate-limit truncation, a provider
  // hiccup), never a valid answer — every prompt asks for JSON or prose. Throw so
  // loggedAi records it as `error` (→ user-facing "AI delayed" banner) and
  // Trigger.dev retries, instead of the "" parsing to null downstream and
  // surfacing as a benign "nothing found". A valid empty array (e.g. {plans:[]})
  // is non-empty text here, so genuine "no public pricing" still passes through.
  if (!text.trim()) {
    throw new Error(`Empty completion from provider ${config.provider}`);
  }
  return text;
}
