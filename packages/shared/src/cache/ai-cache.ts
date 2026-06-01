import { createHash } from "node:crypto";
import { getRedis } from "../redis";

export interface AiCacheOptions {
  /** Logical bucket for the key, e.g. "classify" | "analyze" | "score-overlap". */
  namespace: string;
  ttlSeconds: number;
}

export interface AiCacheResult<T> {
  value: T;
  cached: boolean;
}

function makeCacheKey(namespace: string, input: string): string {
  // Hash the content only — never an API key or secret ends up in a key.
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 24);
  return `ai:${namespace}:${hash}`;
}

/**
 * Wrap a deterministic AI call with a Redis cache keyed by a hash of its input.
 * Same input → cached result, no model call. If Redis is unreachable (or not
 * configured), it degrades silently and just runs `fn()`.
 *
 * Only ever applied to deterministic tasks (classify / analyze / score) — never
 * to creative generations (signal / digest / battle card).
 *
 * `null` / `undefined` results are never cached, so a parse failure is retried
 * on the next call instead of being pinned for the whole TTL.
 */
export async function withAiCache<T>(
  input: string,
  options: AiCacheOptions,
  fn: () => Promise<T>,
): Promise<AiCacheResult<T>> {
  const redis = getRedis();
  const key = makeCacheKey(options.namespace, input);

  if (redis) {
    try {
      const hit = await redis.get<T>(key);
      if (hit !== null && hit !== undefined) {
        console.debug(`[ai-cache] hit ${options.namespace}`);
        return { value: hit, cached: true };
      }
    } catch {
      // Redis unreachable — degrade silently to a direct call.
    }
  }

  const value = await fn();

  if (redis && value !== null && value !== undefined) {
    try {
      await redis.set(key, value, { ex: options.ttlSeconds });
    } catch {
      // Cache write failures must never break the request.
    }
  }

  return { value, cached: false };
}
