import { createHash } from "node:crypto";
import type { auth } from "./auth";

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;
type Resolved = { session: NonNullable<Session>; orgId: string | null; expires: number };

// Per-request auth used to cost three DB round-trips EVERY time: Better Auth reads
// the session row, then the user row, then we read our own users mirror for the
// suspension flag and orgId. One dashboard navigation fires 8 to 14 API calls and
// the open tab polls several endpoints on a 30s loop, so those three queries were
// the single most-repeated database work in the product.
//
// Two things changed after the 2026-09-02 audit (S-08).
//
// The map is keyed by sha256(token), not by the token itself. The values are live
// session credentials: a heap dump, a core file or an accidental log of this map
// used to hand over up to 5000 usable cookies. A digest is enough to look an entry
// up and worthless to replay.
//
// Revocation no longer waits for the TTL. `evictUserSessions` drops every entry
// belonging to a user and is called wherever access is taken away: an operator
// suspending an account (routes/admin/users.ts) and the Better Auth revocation
// endpoints (sign-out, revoke-session(s), change/set-password, wired in index.ts).
// A linear scan is the right shape here, the map is bounded at 5000 and these paths
// fire once in a while, never per request.
//
// RESIDUAL: this cache is per process. With more than one API instance, an eviction
// on one leaves the others serving their own copy until the TTL lapses. Today there
// is exactly one api container; a second one makes an Upstash-backed cache (SETEX 30
// + DEL on revoke) a prerequisite, not an optimisation.
//
// TTL is deliberately short and overridable; SESSION_CACHE_TTL_MS=0 disables the
// cache entirely and restores the pre-cache behaviour exactly.
export const SESSION_CACHE_TTL_MS = Number(process.env.SESSION_CACHE_TTL_MS ?? 30_000);

// Bounded so a burst of tokens can't grow the process heap without limit. Sized far
// above any plausible concurrent-session count for a single API instance.
const MAX_ENTRIES = 5_000;

const cache = new Map<string, Resolved>();

const keyOf = (token: string): string => createHash("sha256").update(token).digest("hex");

export function readCachedSession(token: string): Resolved | null {
  const key = keyOf(token);
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit;
}

export function writeCachedSession(token: string, value: Omit<Resolved, "expires">): void {
  if (cache.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
    // Still full of live entries → drop everything rather than grow. A cold cache
    // costs latency, never correctness.
    if (cache.size >= MAX_ENTRIES) cache.clear();
  }
  cache.set(keyOf(token), { ...value, expires: Date.now() + SESSION_CACHE_TTL_MS });
}

/** Drop every cached session of one user. Call it the moment access is revoked. */
export function evictUserSessions(userId: string): void {
  for (const [key, entry] of cache) {
    if (entry.session.user.id === userId) cache.delete(key);
  }
}
