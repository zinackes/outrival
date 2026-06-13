import { redis } from "@outrival/shared";

/**
 * Provider pool (patch-22). The AI source is a pool of *legal* OpenAI-compatible
 * providers (Cerebras free, Groq, Hyperbolic paid) tried free-first then paid —
 * NOT a pool of Groq accounts (multi-account would violate Groq's ToS). All three
 * speak the OpenAI chat-completions API, so one client routes them by baseUrl.
 *
 * Rotation logic: pick the lowest-priority (= most free) provider that is neither
 * exhausted for today (Redis token counter) nor in its circuit breaker; round-robin
 * only between providers of equal priority. Token quota and breaker live in Redis so
 * tracking is shared across isolated Trigger.dev run machines; without Upstash the
 * `redis` facade no-ops and the pool degrades to "first provider, no tracking".
 */
export interface Provider {
  id: string; // "cerebras", "groq", "hyperbolic"
  baseUrl: string; // OpenAI-compatible endpoint
  apiKey: string;
  model: string; // model name at this provider
  fastModel?: string; // optional cheap small (8B-class) model on the same endpoint
  tier: "free" | "paid";
  dailyTokenQuota: number;
  priority: number; // lower = tried first (free before paid)
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
    providers.push({
      id,
      baseUrl,
      apiKey,
      model: process.env[`AI_PROVIDER_${i}_MODEL`]?.trim() || "llama-3.3-70b",
      fastModel: process.env[`AI_PROVIDER_${i}_FAST_MODEL`]?.trim() || undefined,
      tier: process.env[`AI_PROVIDER_${i}_TIER`] === "paid" ? "paid" : "free",
      dailyTokenQuota: Number(process.env[`AI_PROVIDER_${i}_DAILY_TOKEN_QUOTA`] ?? 500000),
      priority: Number(process.env[`AI_PROVIDER_${i}_PRIORITY`] ?? 99),
    });
  }

  if (providers.length === 0) {
    const groqKey = process.env.GROQ_API_KEY?.trim();
    if (groqKey) {
      providers.push({
        id: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: groqKey,
        model: "llama-3.3-70b-versatile",
        fastModel: "llama-3.1-8b-instant",
        tier: "free",
        dailyTokenQuota: 500000,
        priority: 1,
      });
    }
  }

  return providers.sort((a, b) => a.priority - b.priority); // free / low priority first
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Pick the next available provider by priority (free before paid). Skips providers
 * exhausted today (>= 95% of their token quota) or in circuit breaker. Round-robins
 * only between providers sharing the best available priority. Returns null when none
 * are usable (→ caller trips the global breaker).
 */
export async function pickProvider(): Promise<Provider | null> {
  const providers = loadProviders();
  if (providers.length === 0) return null;
  const today = todayKey();

  const available: Provider[] = [];
  for (const p of providers) {
    const [breaker, used] = await redis.mget(`ai:breaker:${p.id}`, `ai:usage:${p.id}:${today}`);
    if (breaker) continue;
    if (Number(used ?? 0) >= p.dailyTokenQuota * 0.95) continue;
    available.push(p);
  }
  if (available.length === 0) return null;

  // Keep only the providers at the best available priority, then round-robin them.
  const bestPriority = available[0]!.priority;
  const topTier = available.filter((p) => p.priority === bestPriority);
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

/** Put a provider in its circuit breaker for AI_CIRCUIT_BREAKER_RESET_MIN minutes. */
export async function tripBreaker(providerId: string, reason: string): Promise<void> {
  const resetMin = Number(process.env.AI_CIRCUIT_BREAKER_RESET_MIN ?? 10);
  await redis.set(`ai:breaker:${providerId}`, reason, { ex: resetMin * 60 });
}
