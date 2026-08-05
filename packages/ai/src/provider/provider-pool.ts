import { redis } from "@outrival/shared";
import { slidingWindowTokens, hasHeadroom, WINDOW_MS } from "./tpm-window";

/**
 * Provider pool (patch-22). The AI source is a pool of *legal* OpenAI-compatible
 * providers (Cerebras, Cloudflare Workers AI, Groq, Mistral) tried free-first then
 * paid — NOT a pool of Groq accounts (multi-account would violate Groq's ToS). They
 * all speak the OpenAI chat-completions API, so one client routes them by baseUrl.
 *
 * Rotation logic: pick the lowest-priority (= most free) provider that is neither
 * exhausted for today (Redis token counter) nor in its circuit breaker; round-robin
 * only between providers of equal priority. Token quota and breaker live in Redis so
 * tracking is shared across isolated Trigger.dev run machines; without Upstash the
 * `redis` facade no-ops and the pool degrades to "first provider, no tracking".
 */
export interface Provider {
  id: string; // "cerebras", "cloudflare", "groq", "mistral"
  baseUrl: string; // OpenAI-compatible endpoint
  apiKey: string;
  model: string; // model name at this provider
  fastModel?: string; // optional cheap small (8B-class) model on the same endpoint
  tier: "free" | "paid";
  dailyTokenQuota: number;
  /**
   * Biggest SINGLE request this provider will accept, in tokens — distinct from the
   * daily quota, which is a budget. Groq's free tier caps one request at its 8000
   * tokens-per-minute allowance and answers 413 above it, so a task whose prompt is
   * structurally bigger can NEVER succeed there however many times it is retried:
   * `generate_extractor` sends ~12k tokens of pruned HTML and failed 198 times on
   * Groq in a week while succeeding 206 times on Cerebras. Unset = no ceiling known,
   * which is today's behaviour (attempt it and let the provider answer).
   */
  maxRequestTokens?: number;
  priority: number; // lower = tried first (free before paid)
  /**
   * Per-minute token ceiling at this provider (AI_PROVIDER_N_TPM_LIMIT). 0 =
   * unknown, which disables pacing for it and restores the pre-pacing behaviour.
   * Distinct from dailyTokenQuota: the daily one is the limit we never hit, the
   * per-minute one is the limit the hourly fan-out walks into every day.
   */
  tpmLimit: number;
  // Optional override for reasoning models (gpt-oss). Unset → callLLM auto-picks
  // "low" for gpt-oss (cheapest, validated equal quality) and sends nothing for
  // non-reasoning models. Only set this to deviate (e.g. "medium").
  reasoningEffort?: "low" | "medium" | "high";
  /**
   * Whether this provider/model honours `response_format: { type: "json_schema" }`
   * — constrained decoding against a schema, which makes a malformed reply
   * impossible rather than unlikely (Véracité P3). A capability, not a preference:
   * the same task sends a plain `json_object` to a provider without it, so the pool
   * stays heterogeneous and no failover path changes.
   *
   * Declared per provider (AI_PROVIDER_N_JSON_SCHEMA=true) and DEFAULT OFF: a
   * provider that advertises the field but rejects our schema answers 400, which is
   * the one status the pool does NOT fail over on (a request we built wrong hits
   * every provider identically). Turn it on per provider once verified.
   */
  supportsJsonSchema?: boolean;
}

// Log the loaded pool ONCE per process (ids + base URLs + models, never keys). A
// misconfigured pool (a base URL missing /v1, a wrong model id, or only one provider
// where three are expected) is the #1 cause of "all providers 404" outages, and is
// otherwise invisible — this single line in the worker/API boot logs makes it obvious.
let poolLogged = false;
function logPoolOnce(providers: Provider[]): void {
  if (poolLogged) return;
  poolLogged = true;
  if (providers.length === 0) {
    console.warn(
      "[ai] provider pool is EMPTY — no AI_PROVIDER_* and no GROQ_API_KEY. Every AI task will fail.",
    );
    return;
  }
  const summary = providers
    .map((p) => `${p.id}[${p.tier},p${p.priority}] ${p.baseUrl} model=${p.model}`)
    .join(" | ");
  console.log(`[ai] provider pool loaded (${providers.length}): ${summary}`);
}

/**
 * Load providers from AI_PROVIDER_1..N_* env (contiguous, stops at first gap).
 * Back-compat: if none are configured but GROQ_API_KEY exists, synthesize a single
 * Groq provider so existing setups keep working without the new env block.
 */
export function loadProviders(): Provider[] {
  const providers: Provider[] = [];
  for (let i = 1; i <= 10; i++) {
    const id = process.env[`AI_PROVIDER_${i}_ID`]?.trim();
    const apiKey = process.env[`AI_PROVIDER_${i}_API_KEY`]?.trim();
    const baseUrl = process.env[`AI_PROVIDER_${i}_BASE_URL`]?.trim();
    if (!id || !apiKey || !baseUrl) continue;
    const re = process.env[`AI_PROVIDER_${i}_REASONING_EFFORT`]?.trim();
    const maxReq = Number(process.env[`AI_PROVIDER_${i}_MAX_REQUEST_TOKENS`] ?? 0);
    providers.push({
      id,
      baseUrl,
      apiKey,
      model: process.env[`AI_PROVIDER_${i}_MODEL`]?.trim() || "llama-3.3-70b",
      fastModel: process.env[`AI_PROVIDER_${i}_FAST_MODEL`]?.trim() || undefined,
      tier: process.env[`AI_PROVIDER_${i}_TIER`] === "paid" ? "paid" : "free",
      dailyTokenQuota: Number(process.env[`AI_PROVIDER_${i}_DAILY_TOKEN_QUOTA`] ?? 500000),
      maxRequestTokens: Number.isFinite(maxReq) && maxReq > 0 ? maxReq : undefined,
      tpmLimit: Number(process.env[`AI_PROVIDER_${i}_TPM_LIMIT`] ?? 0),
      priority: Number(process.env[`AI_PROVIDER_${i}_PRIORITY`] ?? 99),
      reasoningEffort: re === "low" || re === "medium" || re === "high" ? re : undefined,
      supportsJsonSchema: process.env[`AI_PROVIDER_${i}_JSON_SCHEMA`] === "true",
    });
  }

  if (providers.length === 0) {
    const groqKey = process.env.GROQ_API_KEY?.trim();
    if (groqKey) {
      providers.push({
        id: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: groqKey,
        // Groq discontinues llama-3.1-8b-instant and llama-3.3-70b-versatile on
        // 2026-08-16 for free/developer tiers (ours). These are Groq's own
        // recommended replacements. https://console.groq.com/docs/deprecations
        model: "openai/gpt-oss-120b",
        fastModel: "openai/gpt-oss-20b",
        tier: "free",
        dailyTokenQuota: 500000,
        // Groq's published free ceiling for gpt-oss-120b. Hard-coded here because
        // this branch synthesizes a provider from a bare GROQ_API_KEY, so there is
        // no AI_PROVIDER_N_TPM_LIMIT to read.
        tpmLimit: 8000,
        priority: 1,
      });
    }
  }

  const sorted = providers.sort((a, b) => a.priority - b.priority); // free / low priority first
  logPoolOnce(sorted);
  return sorted;
}

export type ProviderCheck = { id: string; ok: boolean; detail: string };

/**
 * Boot-time sanity check: does each provider actually serve the model we configured?
 *
 * This is the one question no env validation can answer, and it is the question that
 * mattered — on 2026-07-22 the pool loaded two healthy-looking providers and every p1
 * call 404'd because AI_PROVIDER_1_MODEL named a model Cerebras does not serve. That
 * is invisible until the first AI task fails, and the failure surfaces as a global
 * breaker trip rather than as "fix this variable", so it cost a day of dead AI.
 *
 * Reads /models (no tokens, no generation) and reports; the caller decides what to do
 * with the verdict. Deliberately NOT fatal: a worker with a broken pool must still
 * scrape, per the existing choice in apps/workers/src/env.ts. `fetchImpl` is injected
 * for the unit test.
 */
export async function checkProviderModels(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<ProviderCheck[]> {
  const results: ProviderCheck[] = [];
  for (const p of loadProviders()) {
    const wanted = [p.model, ...(p.fastModel ? [p.fastModel] : [])];
    try {
      const res = await fetchImpl(`${p.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${p.apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        // An unreachable /models says nothing about the models themselves — a
        // provider may not implement it. Never report that as a config fault.
        results.push({ id: p.id, ok: true, detail: `/models unavailable (${res.status}), skipped` });
        continue;
      }
      const json = (await res.json()) as { data?: { id?: string }[] };
      const served = new Set((json.data ?? []).map((m) => m.id).filter(Boolean));
      if (served.size === 0) {
        results.push({ id: p.id, ok: true, detail: "/models returned nothing, skipped" });
        continue;
      }
      const missing = wanted.filter((m) => !served.has(m));
      results.push(
        missing.length === 0
          ? { id: p.id, ok: true, detail: wanted.join(", ") }
          : {
              id: p.id,
              ok: false,
              detail: `does not serve ${missing.join(", ")} — available: ${[...served].sort().join(", ")}`,
            },
      );
    } catch (err) {
      results.push({
        id: p.id,
        ok: true,
        detail: `unreachable (${err instanceof Error ? err.message : String(err)}), skipped`,
      });
    }
  }
  return results;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Minute bucket key for a provider's per-minute token window. */
function tpmKey(providerId: string, epochMs: number): string {
  return `ai:tpm:${providerId}:${Math.floor(epochMs / WINDOW_MS)}`;
}

/** Tokens spent at this provider over the trailing minute. */
async function observedTpm(providerId: string, now: number): Promise<number> {
  const [previous, current] = await redis.mget(
    tpmKey(providerId, now - WINDOW_MS),
    tpmKey(providerId, now),
  );
  return slidingWindowTokens(Number(previous ?? 0), Number(current ?? 0), now % WINDOW_MS);
}

/**
 * Book tokens against a provider's per-minute window and return the bucket key, so
 * the caller can reconcile the estimate against the real usage in the SAME bucket
 * once the call returns. Reconciling into whatever bucket is current at that point
 * would credit a minute that never spent the tokens on a call spanning a boundary.
 *
 * Booked BEFORE the call, not after: N concurrent calls all reading an empty window
 * and all firing is precisely the burst this exists to stop.
 */
export async function reserveTpm(providerId: string, tokens: number): Promise<string> {
  const key = tpmKey(providerId, Date.now());
  await redis.incrby(key, Math.round(tokens));
  // Two windows plus slack: the bucket only has to outlive its own use as the
  // "previous minute" of the next window.
  await redis.expire(key, 180);
  return key;
}

/** Correct a reservation once the real usage is known. `delta` may be negative. */
export async function reconcileTpm(bucketKey: string, delta: number): Promise<void> {
  if (Math.round(delta) === 0) return;
  await redis.incrby(bucketKey, Math.round(delta));
}

/**
 * Rough token count for a request, from characters. ~4 chars/token is the standard
 * English approximation and it UNDER-estimates markup-heavy payloads, which is the
 * safe direction here: the number only ever decides whether to SKIP a provider, so
 * erring low means we still attempt a borderline call and let the provider answer.
 * The reply budget counts too — the free tiers bill a request's `max_tokens` against
 * the same allowance they refuse it with. Pure.
 */
export function estimateRequestTokens(text: string, maxTokens: number): number {
  return Math.ceil(text.length / 4) + maxTokens;
}

/**
 * The providers that could accept a request of this size at all. A provider whose
 * published per-request ceiling is below it is not "unavailable", it is structurally
 * wrong for this task — attempting it buys a guaranteed 413 and, worse, a wasted
 * failover slot that makes an oversized prompt look like an outage. Pure.
 */
export function providersAcceptingSize(providers: Provider[], requestTokens: number): Provider[] {
  return providers.filter((p) => !p.maxRequestTokens || requestTokens <= p.maxRequestTokens);
}

/**
 * Pick the next available provider by priority (free before paid). Skips providers
 * exhausted today (>= 95% of their token quota), in circuit breaker, in `exclude`
 * (providers the current callLLM loop has already tried — Redis-independent failover,
 * see callLLM), or too small for `requestTokens`.
 *
 * Two ceilings, and they are different kinds of thing. `requestTokens` against
 * `maxRequestTokens` is a WALL: a request bigger than it earns a guaranteed 413, so
 * such a provider is REMOVED — attempting it spends a failover slot to be told what
 * we already knew. The per-minute window is a RATE: a request that fits may still
 * arrive in a minute already spent, so such a provider is only DEPRIORITISED. We
 * prefer whoever has headroom and fall back to the best-priority usable provider
 * when nobody does, because the estimate is a ratio on a character count rather than
 * a tokenizer and must never be the sole reason a task fails. The floor stays exactly
 * the pre-pacing behaviour; the win is that a saturated provider is skipped BEFORE it
 * answers 429 and gets parked for two minutes, not after.
 *
 * `interactive` lets a call someone is watching draw on the share of each ceiling
 * that background work is held back from (AI_INTERACTIVE_RESERVE_FRACTION).
 */
export async function pickProvider(
  exclude?: ReadonlySet<string>,
  requestTokens = 0,
  interactive = false,
): Promise<Provider | null> {
  const providers = providersAcceptingSize(loadProviders(), requestTokens);
  if (providers.length === 0) return null;
  const today = todayKey();
  const now = Date.now();
  const reserveFraction = Number(process.env.AI_INTERACTIVE_RESERVE_FRACTION ?? 0.2);

  const available: Provider[] = [];
  const withHeadroom: Provider[] = [];
  for (const p of providers) {
    if (exclude?.has(p.id)) continue;
    const [breaker, used] = await redis.mget(`ai:breaker:${p.id}`, `ai:usage:${p.id}:${today}`);
    if (breaker) continue;
    if (Number(used ?? 0) >= p.dailyTokenQuota * 0.95) continue;
    available.push(p);
    if (
      requestTokens === 0 ||
      hasHeadroom({
        observed: await observedTpm(p.id, now),
        limit: p.tpmLimit,
        cost: requestTokens,
        reserveFraction,
        interactive,
      })
    ) {
      withHeadroom.push(p);
    }
  }
  const pool = withHeadroom.length > 0 ? withHeadroom : available;
  if (pool.length === 0) return null;

  // Keep only the providers at the best available priority, then round-robin them.
  const bestPriority = pool[0]!.priority;
  const topTier = pool.filter((p) => p.priority === bestPriority);
  if (topTier.length === 1) return topTier[0]!;

  const idx = await redis.incr(`ai:roundrobin:${bestPriority}`);
  await redis.expire(`ai:roundrobin:${bestPriority}`, 3600);
  return topTier[idx % topTier.length]!;
}

/** Track consumed tokens (input+output) for today — not just request count. */
export async function trackUsage(providerId: string, tokens: number): Promise<void> {
  const key = `ai:usage:${providerId}:${todayKey()}`;
  await redis.incrby(key, Math.max(1, Math.round(tokens)));
  await redis.expire(key, 86400 * 2); // keep 2 days for debugging
}

/**
 * Put a provider in its circuit breaker. Defaults to AI_CIRCUIT_BREAKER_RESET_MIN
 * minutes — the right scale for a provider that is broken (bad key, wrong model) and
 * will not fix itself by being retried. `ttlSec` overrides it for a fault that DOES
 * self-heal on its own clock, namely a rate limit: see rateLimitBackoffSec.
 */
export async function tripBreaker(
  providerId: string,
  reason: string,
  ttlSec?: number,
): Promise<void> {
  const resetMin = Number(process.env.AI_CIRCUIT_BREAKER_RESET_MIN ?? 10);
  await redis.set(`ai:breaker:${providerId}`, reason, { ex: ttlSec ?? resetMin * 60 });
}
