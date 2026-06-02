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
import { markProvider } from "./provider/provider-context";

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
}

// A 429 (rate limit) or 5xx is transient and worth failing over to another
// provider; a 4xx (bad request/auth) is a real error every provider would hit.
function isTransient(err: unknown): boolean {
  return err instanceof OpenAI.APIError && (err.status === 429 || (err.status ?? 0) >= 500);
}

/**
 * Run a completion against the provider pool (patch-22). Picks the best available
 * provider (free before paid, skipping exhausted/breakered ones), and on a transient
 * failure trips that provider's breaker and fails over to the next — so a synchronous
 * caller (onboarding analyze, discovery) stays resilient without relying on a job
 * retry. Records the actual provider for ai_runs via markProvider, tracks token usage,
 * and trips the global breaker when every provider is down.
 */
async function callLLM(options: CompletionOptions): Promise<string> {
  const breaker = await checkGlobalBreaker();
  if (breaker.open) throw new AIUnavailableError(breaker.reason ?? "ai_unavailable");

  const maxAttempts = Math.max(1, loadProviders().length);
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const provider = await pickProvider();
    if (!provider) break; // every provider exhausted or in breaker
    markProvider(provider.id);
    try {
      const res = await clientFor(provider).chat.completions.create({
        model: provider.model,
        messages: [{ role: "user", content: options.prompt }],
        max_tokens: options.maxTokens ?? 1024,
        ...(options.json && { response_format: { type: "json_object" as const } }),
      });
      await trackUsage(provider.id, res.usage?.total_tokens ?? 0);
      await recordSuccess();
      return res.choices[0]?.message?.content ?? "";
    } catch (err) {
      if (isTransient(err)) {
        const rateLimited = err instanceof OpenAI.APIError && err.status === 429;
        await tripBreaker(provider.id, rateLimited ? "rate_limited" : "provider_error");
        await recordFailure(provider.id);
        lastErr = err;
        continue;
      }
      throw err; // real error — fail fast, don't churn the pool
    }
  }

  await tripGlobalBreaker("no_providers_available");
  throw new AIUnavailableError(
    lastErr instanceof Error ? `all_providers_failed: ${lastErr.message}` : "no_providers_available",
  );
}

async function dispatch(
  config: AITaskConfig,
  options: CompletionOptions,
): Promise<string> {
  if (config.provider === "groq") {
    // "groq" now means "the provider pool"; the served model is the provider's own
    // (the per-task 8b/70b split collapses into each provider's single model).
    return callLLM(options);
  }

  if (config.provider === "claude") {
    markProvider("claude");
    const res = await getClaude().messages.create({
      model: config.model,
      max_tokens: options.maxTokens ?? 1024,
      messages: [{ role: "user", content: options.prompt }],
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
