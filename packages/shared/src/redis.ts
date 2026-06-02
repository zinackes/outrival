import { Redis } from "@upstash/redis";

/**
 * Lazy Upstash REST client, reachable from anywhere (Trigger.dev Cloud workers
 * included — that's the point of the REST transport). Re-introduced in patch-09
 * solely for the deterministic AI cache; Upstash was dropped in Phase 6 when
 * real-time alerts moved to SSE.
 *
 * Returns `null` when the credentials are absent so every caller degrades
 * silently (no cache) instead of crashing — dev and prod-without-Upstash both
 * keep working.
 */
let client: Redis | null = null;
let resolved = false;

export function getRedis(): Redis | null {
  if (resolved) return client;
  resolved = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  client = new Redis({ url, token });
  return client;
}

/**
 * Safe facade over the lazy Upstash client (patch-22). The AI provider pool,
 * circuit breaker, and rate limiters call `redis.*` directly; when Upstash is
 * not configured every method no-ops with a neutral value so the engine degrades
 * to "first provider, no cross-process tracking" instead of crashing. Mirrors the
 * subset of Upstash methods those callers use.
 */
export interface SafeRedis {
  get<T = string>(key: string): Promise<T | null>;
  set(key: string, value: string | number, opts?: { ex: number }): Promise<unknown>;
  incr(key: string): Promise<number>;
  incrby(key: string, n: number): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  mget<T = string>(...keys: string[]): Promise<(T | null)[]>;
  del(...keys: string[]): Promise<number>;
  ttl(key: string): Promise<number>;
}

export const redis: SafeRedis = {
  async get<T = string>(key: string) {
    const c = getRedis();
    return c ? ((await c.get<T>(key)) as T | null) : null;
  },
  async set(key, value, opts) {
    const c = getRedis();
    if (!c) return null;
    return opts ? c.set(key, value, opts) : c.set(key, value);
  },
  async incr(key) {
    const c = getRedis();
    return c ? c.incr(key) : 0;
  },
  async incrby(key, n) {
    const c = getRedis();
    return c ? c.incrby(key, n) : 0;
  },
  async expire(key, seconds) {
    const c = getRedis();
    return c ? c.expire(key, seconds) : 0;
  },
  async mget<T = string>(...keys: string[]) {
    const c = getRedis();
    return c ? ((await c.mget<T[]>(...keys)) as (T | null)[]) : keys.map(() => null);
  },
  async del(...keys) {
    const c = getRedis();
    return c ? c.del(...keys) : 0;
  },
  async ttl(key) {
    const c = getRedis();
    return c ? c.ttl(key) : -2;
  },
};
