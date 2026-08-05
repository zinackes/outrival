import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { AITaskConfig } from "./config";
import { aiEnv } from "./env";
import {
  estimateRequestTokens,
  loadProviders,
  pickProvider,
  providersAcceptingSize,
  trackUsage,
  tripBreaker,
  reserveTpm,
  reconcileTpm,
  type Provider,
} from "./provider/provider-pool";
import {
  checkGlobalBreaker,
  recordFailure,
  recordSuccess,
  tripGlobalBreaker,
  AIUnavailableError,
} from "./provider/circuit-breaker";
import {
  markProvider,
  markModel,
  markUsage,
  markTruncated,
  isInteractive,
} from "./provider/provider-context";

// One OpenAI client per pool provider (Cerebras/Cloudflare/Groq/Mistral are all
// OpenAI-compatible, routed by baseURL). maxRetries lets the SDK absorb a transient
// 429/5xx — but only on the LAST provider we have, see LAST_RESORT_SDK_RETRIES.
const openaiClients = new Map<string, OpenAI>();

// The SDK honours a 429's `retry-after` by SLEEPING, and the free tiers answer with
// a full minute. That sleep is invisible from here: the call just takes 60s and then
// succeeds, so the pool's own failover — the entire point of having several providers
// — never fires. Measured on prod (2026-07-31): every faithfulness gate that hit one
// came back at 57-60s whatever its call count, while the same calls run in ~0.5s
// unthrottled, and the user watched a whole minute of "Checking it against the
// evidence" for it. So: no SDK-level retry while another provider is untried — a
// throttled provider is answered by asking someone else, immediately. The sleep is
// only worth it when there IS nobody else, which is the one case it was written for.
const LAST_RESORT_SDK_RETRIES = 2;
let claudeClient: Anthropic | null = null;

function clientFor(p: Provider): OpenAI {
  let c = openaiClients.get(p.id);
  if (!c) {
    c = new OpenAI({ apiKey: p.apiKey, baseURL: p.baseUrl, maxRetries: 0 });
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
   * A JSON Schema to decode against (Véracité P3). Honoured only by a pool provider
   * that declares `supportsJsonSchema`; everywhere else the call falls back to the
   * plain `json` object mode, byte-identical to what it sends today. Same call, same
   * tokens — this constrains the decoder, it does not add a round trip.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /**
   * Static, byte-identical-across-calls instructions (role, rules, schema). Sent
   * as a separate `system` message so the variable payload stays in `prompt` at
   * the tail — Groq/Cerebras auto-cache the shared prefix for free, and the Claude
   * fallback marks it `cache_control: ephemeral` (F2). Omit to keep one user
   * message (today's behavior).
   */
  system?: string;
  /**
   * Called as the reply arrives, with everything received SO FAR (not the delta), so
   * a reader can watch the text being written instead of waiting for the whole call.
   * Setting it switches the request to a streamed one.
   *
   * It is always the full prefix because a failover starts a new reply from scratch:
   * the consumer overwrites its buffer with what it is given and a restart needs no
   * protocol of its own. Anything already shown is superseded, never appended to.
   *
   * Never throws into the call — a consumer error is swallowed, since a display
   * concern must not fail a generation.
   */
  onPartial?: (textSoFar: string) => void;
}

// A 429/5xx is transient. A per-provider 401/403/404 (bad key or missing model at
// THIS provider) is permanent for this provider, but the next one — different key
// and model — may still work, so fail over too. Only a 400 (a request WE built
// wrong) would hit every provider identically → fail fast.
function shouldFailover(err: unknown): boolean {
  if (!(err instanceof OpenAI.APIError)) return false;
  const s = err.status ?? 0;
  return s === 429 || s === 413 || s === 401 || s === 403 || s === 404 || s >= 500;
}

// 413 = this request does not fit THIS provider's limits. Groq's free tier counts
// `prompt_tokens + max_tokens` against a per-minute ceiling of 8000, so a prompt of
// 3.5k asking for a 6k answer is refused outright — while Cerebras (1M/day) or a
// paid provider would take it. That makes 413 the clearest possible failover signal
// and, unlike every other failover cause, it says nothing at all about the
// provider's health: parking it would push small tasks off a perfectly good
// provider because one big task didn't fit.
// Exported for unit testing this branch, like isConfigError below.
export function isTooLarge(err: unknown): boolean {
  return err instanceof OpenAI.APIError && err.status === 413;
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

// How long to park a RATE-LIMITED provider, as opposed to a broken one. The breaker
// used to apply AI_CIRCUIT_BREAKER_RESET_MIN (10 min) to both, which is the wrong
// order of magnitude for a quota that refills continuously: Groq's own 429 says
// "Please try again in 5.91s", so we were parking it ~100x longer than it asked. The
// cost is not the wasted provider — it is that ALL traffic shifts onto the other one
// for ten minutes, which is exactly how it saturates and gets parked too, leaving
// pickProvider with nothing (no_providers_available). Prefer what the provider tells
// us, in its own words; the ceiling keeps a hostile/garbled value from recreating the
// long park by accident.
const RATE_LIMIT_BACKOFF_FALLBACK_SEC = 30;
const RATE_LIMIT_BACKOFF_MAX_SEC = 120;

// How long to park a provider that answered 200 with an EMPTY body. Short, because
// the fault belongs to the request (its max_tokens budget against a reasoning model's
// hidden reasoning), not to the provider: the same provider serves the next, smaller
// prompt fine. This used to fall through to AI_CIRCUIT_BREAKER_RESET_MIN — the scale
// meant for a bad key — so one oversized prompt on the priority-1 provider handed the
// whole fleet to the next provider down for ten minutes, long enough for that one to
// hit its own per-request ceiling and leave the pool with nobody. Measured on prod
// (2026-08-02): 475 pool exhaustions in a week, every one of them attributed to the
// last provider standing. The in-call `tried` set already stops THIS call re-picking
// it, so this park only has to cool other concurrent tasks.
const EMPTY_COMPLETION_PARK_SEC = 60;

export function rateLimitBackoffSec(
  err: unknown,
  fallbackSec = RATE_LIMIT_BACKOFF_FALLBACK_SEC,
): number {
  const clamp = (n: number): number =>
    Math.min(RATE_LIMIT_BACKOFF_MAX_SEC, Math.max(1, Math.ceil(n)));

  if (err instanceof OpenAI.APIError) {
    // Standard, and what most providers send.
    const retryAfter = Number(err.headers?.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return clamp(retryAfter);
    // Groq puts the wait in prose on the TPM 429s we actually see in production,
    // with no retry-after header alongside it.
    const stated = /try again in ([\d.]+)\s*s/i.exec(err.message ?? "")?.[1];
    if (stated !== undefined) {
      const secs = Number(stated);
      if (Number.isFinite(secs) && secs > 0) return clamp(secs);
    }
  }
  return clamp(fallbackSec);
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
 * What a pool exhaustion MEANS, decided from what the attempts actually returned.
 * The distinction that matters is whether anything was genuinely down: only then may
 * the failure count toward the global breaker, which pauses AI for the whole
 * workspace. A request the pool refuses on its own terms (too large, or answered
 * empty by every provider) reproduces everywhere precisely BECAUSE it is the same
 * request, so treating it as an outage blanks AI over one bad task.
 * Pure, and exported for the unit test.
 */
export type PoolExhaustion = "misconfigured" | "too_large" | "empty_replies" | "transient";

export function classifyExhaustion(seen: {
  configError: boolean;
  transientError: boolean;
  tooLarge: boolean;
  emptyCompletion: boolean;
}): PoolExhaustion {
  // A transient fault anywhere means something really was distressed: it outranks
  // every "the request was the problem" reading below.
  if (seen.transientError) return "transient";
  if (seen.configError) return "misconfigured";
  if (seen.tooLarge) return "too_large";
  if (seen.emptyCompletion) return "empty_replies";
  return "transient";
}

/** One provider reply, however it was fetched — the pool logic reads only this. */
interface LLMReply {
  content: string;
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

type ChatBody = Parameters<OpenAI["chat"]["completions"]["create"]>[0];
type ChatRequestOptions = { maxRetries: number };

async function wholeReply(
  client: OpenAI,
  body: ChatBody,
  requestOptions: ChatRequestOptions,
): Promise<LLMReply> {
  const res = await client.chat.completions.create({ ...body, stream: false }, requestOptions);
  return {
    content: res.choices[0]?.message?.content ?? "",
    finishReason: res.choices[0]?.finish_reason ?? null,
    usage: {
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
      totalTokens: res.usage?.total_tokens ?? 0,
    },
  };
}

/**
 * The same call, read as it is written, so a caller can show the text arriving.
 * Identical contract to wholeReply — the pool's failover, breaker, truncation and
 * usage accounting are untouched by which one ran.
 *
 * `include_usage` asks for the usage totals as a final chunk; a provider that does
 * not send it leaves zeros, which the cost tables already read as "uncaptured"
 * rather than as free. A consumer that throws is not allowed to sink the call: the
 * text keeps arriving, only the display stops updating.
 */
async function streamReply(
  client: OpenAI,
  body: ChatBody,
  requestOptions: ChatRequestOptions,
  onPartial: (textSoFar: string) => void,
): Promise<LLMReply> {
  const stream = await client.chat.completions.create(
    { ...body, stream: true, stream_options: { include_usage: true } },
    requestOptions,
  );
  let content = "";
  let finishReason: string | null = null;
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      content += delta;
      try {
        onPartial(content);
      } catch {
        // A display concern must never fail a generation.
      }
    }
    if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
    if (chunk.usage) {
      usage.promptTokens = chunk.usage.prompt_tokens ?? 0;
      usage.completionTokens = chunk.usage.completion_tokens ?? 0;
      usage.totalTokens = chunk.usage.total_tokens ?? 0;
    }
  }
  return { content, finishReason, usage };
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

  // Size the request BEFORE choosing anyone. A provider that publishes a per-request
  // ceiling below it will answer 413 every single time, so attempting it is not a
  // failover, it is a round trip spent to be told what we already knew — and it
  // burned the pool's last slot, which is how one oversized prompt came back as
  // "all_providers_failed" (measured: 430 such calls in a week, 198 of them
  // generate_extractor against Groq's 8000-token free ceiling with a ~12k prompt).
  const maxTokens = options.maxTokens ?? 1024;
  const requestTokens = estimateRequestTokens(
    (options.system ?? "") + options.prompt,
    maxTokens,
  );
  const eligible = providersAcceptingSize(loadProviders(), requestTokens);
  if (eligible.length === 0) {
    // Nothing is down: the prompt is simply bigger than anything the pool serves.
    // Say so without spending a call, and without recordFailure — an oversized task
    // must never look like an outage.
    const ceilings = loadProviders()
      .map((p) => `${p.id}:${p.maxRequestTokens ?? "unbounded"}`)
      .join(", ");
    throw new AIUnavailableError(
      `ai_request_too_large: ~${requestTokens} tokens exceeds every provider's per-request ceiling (${ceilings || "pool empty"})`,
    );
  }

  const maxAttempts = Math.max(1, eligible.length);
  let lastErr: unknown;
  // Track WHY the pool was exhausted: a config-only wipe (every provider 401/403/404)
  // is an env mistake to surface loudly, not the transient infra distress the generic
  // "all_providers_failed / no_providers_available" message implies.
  let sawConfigError = false;
  let sawTransientError = false;
  // A request no provider would accept is a bug in what WE sent, not an outage —
  // see the exhaustion path for why that distinction has to survive to the end.
  let sawTooLarge = false;
  // Same reasoning for a 200 with an empty body: it is a property of the request, so
  // it reproduces on every provider. Tracked separately because the empty-completion
  // branch below sets no error flag at all, which is exactly how it used to reach the
  // exhaustion path unlabelled and be counted as infra distress.
  let sawEmptyCompletion = false;
  // In-memory record of providers already tried THIS call. The per-provider breaker
  // (tripBreaker) only advances pickProvider to the next provider when it persists —
  // which needs Redis. Without Upstash that breaker is a no-op, so pickProvider would
  // keep returning the same top-priority provider every iteration and a broken
  // priority-1 provider would wedge the whole pool (the loop hits it N times, never
  // reaching a healthy lower-priority one). This local set makes failover progress
  // regardless of Redis: each picked provider is excluded from the next pick.
  const tried = new Set<string>();
  // `requestTokens` (computed above for the size filter) is exactly what this
  // request costs against a per-minute ceiling too — output budget included, since
  // providers count prompt + max_tokens before the model runs. One estimate, two
  // uses: remove a provider that cannot take the request at all, deprioritise one
  // whose minute is already spent. Booked before the call and corrected after, so
  // concurrent callers see each other's in-flight spend rather than all reading an
  // empty window and all firing.
  const interactive = isInteractive();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const provider = await pickProvider(tried, requestTokens, interactive);
    if (!provider) break; // every eligible provider exhausted, in breaker, or already tried
    tried.add(provider.id);
    markProvider(provider.id);
    // A "fast"-tier task (classify-change, overlap scoring) routes to the
    // provider's small 8B-class model when declared — ~10× cheaper than the 70B.
    // Falls back to the default model when the provider has no fast model.
    const model = fast && provider.fastModel ? provider.fastModel : provider.model;
    // AI_CONFIG.model is ignored on this path — record what we actually send so
    // ai_runs attributes cost to the real model (see provider-context).
    markModel(model);
    const reasoningEffort = resolveReasoningEffort(model, provider.reasoningEffort);
    // Nobody left to fail over to once every provider has been tried — only then is
    // waiting out a rate limit better than giving up.
    const lastResort = tried.size >= maxAttempts;
    // The window bucket this attempt booked into, while the booking is still an
    // estimate. Cleared once reconciled; read by the failure path to decide whether
    // the booking describes something that happened.
    let bucketKey: string | null = null;
    try {
      const body = {
        model,
        // Static system prefix (when provided) before the variable user payload —
        // a byte-identical prefix lets Groq/Cerebras auto-cache the prefill (F2).
        messages: [
          ...(options.system
            ? [{ role: "system" as const, content: options.system }]
            : []),
          { role: "user" as const, content: options.prompt },
        ],
        max_tokens: maxTokens,
        // Constrained decoding when this provider declares it (P3): the schema is
        // compiled to a grammar and an invalid token cannot be emitted, so "the model
        // wrote bad JSON" stops being a failure mode. Providers without the
        // capability keep the plain object mode — one pool, two request shapes, no
        // change to failover.
        ...(options.jsonSchema && provider.supportsJsonSchema
          ? {
              response_format: {
                type: "json_schema" as const,
                json_schema: {
                  name: options.jsonSchema.name,
                  schema: options.jsonSchema.schema,
                  strict: true,
                },
              },
            }
          : options.json
            ? { response_format: { type: "json_object" as const } }
            : {}),
        // Only sent for reasoning models (gpt-oss) — never for Llama (undefined).
        ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
      };
      const requestOptions = { maxRetries: lastResort ? LAST_RESORT_SDK_RETRIES : 0 };
      const client = clientFor(provider);
      bucketKey = await reserveTpm(provider.id, requestTokens);
      const res = options.onPartial
        ? await streamReply(client, body, requestOptions, options.onPartial)
        : await wholeReply(client, body, requestOptions);
      // Swap the estimate for what it really cost, in the bucket the estimate was
      // booked into (a call spanning a minute boundary must not credit the minute
      // that never spent the tokens).
      await reconcileTpm(bucketKey, res.usage.totalTokens - requestTokens);
      bucketKey = null;
      await trackUsage(provider.id, res.usage.totalTokens);
      // Accumulate per-task token usage for ai_runs cost attribution. Counted here
      // (with trackUsage) even on the empty-content failover below: those tokens
      // were spent, so the cost is real.
      markUsage(res.usage);
      // A reply cut off at max_tokens is syntactically broken JSON, and the parse
      // error it produces downstream ("Unterminated string") names the symptom, not
      // the cause. Flag it on the call scope so the task that owns the budget can
      // say so — a truncation is repaired by raising maxTokens or shrinking the
      // prompt envelope, never by retrying the same call.
      if (res.finishReason === "length") markTruncated();
      const content = res.content;
      // A 200 with empty content is a failed generation, never a valid answer (every
      // prompt asks for JSON or prose). It happens when a reasoning model's hidden
      // reasoning eats the whole max_tokens budget before any answer, or on a silent
      // refusal. Fail over to the next provider instead of returning "" — which used
      // to surface as a hard "Empty completion" throw that failed the task without
      // ever trying another provider, taking down every AI task when the priority-1
      // provider was a reasoning one.
      //
      // The park is deliberately SHORT (see EMPTY_COMPLETION_PARK_SEC) and the flag is
      // what keeps this out of the global breaker. Skipping recordFailure here was
      // never enough on its own: this branch set no error flag, so an exhaustion made
      // of nothing but empty replies fell through to the transient path at the end and
      // was counted anyway — the opposite of what the old comment claimed.
      if (!content.trim()) {
        await tripBreaker(provider.id, "empty_completion", EMPTY_COMPLETION_PARK_SEC);
        sawEmptyCompletion = true;
        lastErr = new Error(`empty completion from ${provider.id}`);
        continue;
      }
      await recordSuccess();
      return content;
    } catch (err) {
      if (shouldFailover(err)) {
        const rateLimited = err instanceof OpenAI.APIError && err.status === 429;
        const tooLarge = isTooLarge(err);
        // A 429 says the window really is full, so the booking stands and keeps the
        // next caller off this provider. Every other failure means the request never
        // ran, so holding its tokens would penalise a provider that spent nothing.
        if (bucketKey && !rateLimited) {
          await reconcileTpm(bucketKey, -requestTokens);
          bucketKey = null;
        }
        if (isConfigError(err)) sawConfigError = true;
        else if (tooLarge) sawTooLarge = true;
        else sawTransientError = true;
        // A refused-as-too-large request leaves the provider healthy: try the next
        // one without parking this one.
        if (tooLarge) {
          lastErr = err;
          continue;
        }
        // Park THIS provider (per-provider breaker) and fail over. We deliberately do
        // NOT feed the GLOBAL breaker here: a per-provider failure the pool routes
        // around (the task still succeeds on the next provider) is not "all providers
        // down". Counting it per-attempt let a persistently-broken priority-1 provider
        // — e.g. a bad Cerebras key that 404s every call — drip failures into the
        // global counter and trip a 10-min workspace-wide blackout while every task was
        // actually succeeding via failover. The global breaker is fed once per TASK, at
        // the exhaustion path below.
        await tripBreaker(
          provider.id,
          rateLimited ? "rate_limited" : "provider_error",
          rateLimited ? rateLimitBackoffSec(err) : undefined,
        );
        lastErr = err;
        continue;
      }
      // A request WE built wrong never reached the model, so its booking describes
      // nothing: release it before failing fast, or one malformed call would pace
      // every caller off a healthy provider for a minute.
      if (bucketKey) await reconcileTpm(bucketKey, -requestTokens);
      throw err; // real error — fail fast, don't churn the pool
    }
  }

  // Pool exhausted for THIS task — every pickable provider failed.
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const exhaustion = classifyExhaustion({
    configError: sawConfigError,
    transientError: sawTransientError,
    tooLarge: sawTooLarge,
    emptyCompletion: sawEmptyCompletion,
  });

  // Config-only exhaustion (every provider rejected with 401/403/404, no transient
  // fault) is a misconfigured pool, not an outage: back-off won't fix an env mistake,
  // so trip the global breaker immediately and loudly to make ops fix AI_PROVIDER_*.
  if (exhaustion === "misconfigured") {
    await tripGlobalBreaker("ai_provider_misconfigured");
    throw new AIUnavailableError(
      `ai_provider_misconfigured: every provider rejected the request (last: ${detail}). ` +
        `Check AI_PROVIDER_*_BASE_URL (needs a trailing /v1) and AI_PROVIDER_*_MODEL.`,
    );
  }
  // Every provider refused the request as too large. Nothing is down: the prompt or
  // the max_tokens budget is simply bigger than the pool can serve, and counting it
  // toward the global breaker would blank AI for the whole workspace over one
  // oversized task. Surface it as what it is, so the fix goes to the caller's budget.
  if (exhaustion === "too_large") {
    throw new AIUnavailableError(`ai_request_too_large: ${detail}`);
  }
  // Every provider answered 200 with an empty body, and nothing errored. Same verdict
  // as too_large and for the same reason: an empty reply is a property of the request
  // (its max_tokens budget against a reasoning model), so it reproduces across the
  // whole pool without anything being down. The fix is the caller's budget, not a
  // ten-minute workspace-wide pause.
  if (exhaustion === "empty_replies") {
    throw new AIUnavailableError(`ai_empty_completions: ${detail}`);
  }
  // Transient cross-provider failure: count this failed TASK (not per attempt).
  // recordFailure trips the global breaker only once AI_CIRCUIT_BREAKER_THRESHOLD
  // tasks fail back-to-back — and any task success calls recordSuccess and clears the
  // streak — so one unlucky task, or a single transient blip on the one provider left
  // pickable while others sit in their per-provider breakers, no longer blanks AI for
  // the whole workspace for 10 minutes.
  await recordFailure();
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
    markModel(config.model);
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
    if (res.stop_reason === "max_tokens") markTruncated();
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
