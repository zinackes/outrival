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
