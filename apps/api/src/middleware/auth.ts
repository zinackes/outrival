import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { users } from "@outrival/db";
import { auth } from "../lib/auth";
import { db } from "../lib/db";

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;
type Resolved = { session: NonNullable<Session>; orgId: string | null; expires: number };

// Per-request auth used to cost three DB round-trips EVERY time: Better Auth reads
// the session row, then the user row, then we read our own users mirror for the
// suspension flag and orgId. One dashboard navigation fires 8 to 14 API calls and
// the open tab polls several endpoints on a 30s loop, so those three queries were
// the single most-repeated database work in the product — re-answering a question
// whose answer cannot change between two fetches of the same page.
//
// The cache is keyed by the session TOKEN, so it is per-session, never per-user:
// two sessions of the same user never share an entry. What it trades is freshness
// of REVOCATION — a sign-out on another device, or an operator suspending an
// account, takes effect up to TTL_MS later instead of instantly. Signing out on
// THIS device is unaffected: it clears the cookie, so the next request carries no
// token and can't hit the cache at all. TTL is deliberately short (30s) and
// overridable; set SESSION_CACHE_TTL_MS=0 to disable the cache entirely and get the
// exact previous behaviour.
const TTL_MS = Number(process.env.SESSION_CACHE_TTL_MS ?? 30_000);
// Bounded so a burst of tokens can't grow the process heap without limit. Sized far
// above any plausible concurrent-session count for a single API instance.
const MAX_ENTRIES = 5_000;
const cache = new Map<string, Resolved>();

function readCached(token: string): Resolved | null {
  const hit = cache.get(token);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    cache.delete(token);
    return null;
  }
  return hit;
}

function writeCached(token: string, value: Omit<Resolved, "expires">): void {
  if (cache.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
    // Still full of live entries → drop everything rather than grow. A cold cache
    // costs latency, never correctness.
    if (cache.size >= MAX_ENTRIES) cache.clear();
  }
  cache.set(token, { ...value, expires: Date.now() + TTL_MS });
}

/**
 * The raw session cookie value, matched by SUFFIX rather than by full name: Better
 * Auth decorates the name with `__Secure-` on secure cookies and with any configured
 * cookie prefix, so hard-coding one spelling would silently never match and turn the
 * cache into dead code. Returns null when the request carries no session at all —
 * such a request must never read or write a cache entry.
 */
function sessionToken(c: Context): string | null {
  const cookies = getCookie(c);
  for (const [name, value] of Object.entries(cookies)) {
    if (name.endsWith("session_token") && value) return value;
  }
  return null;
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const token = TTL_MS > 0 ? sessionToken(c) : null;
  const cached = token ? readCached(token) : null;

  if (cached) {
    c.set("user", cached.session.user);
    c.set("session", cached.session.session);
    c.set("orgId", cached.orgId);
    await next();
    return;
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  // Suspended accounts (set by an operator from /admin) are locked out: existing
  // sessions are rejected here. Lightweight PK lookup; the OTP send path is also
  // gated so no new code is ever issued to a suspended email. We grab orgId in the
  // same row so ensureUserOrg can reuse it (via getContext) instead of re-reading
  // the users table on every authenticated request.
  const appUser = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { suspendedAt: true, orgId: true },
  });
  if (appUser?.suspendedAt) return c.json({ error: "Account suspended" }, 403);

  // Only a clean, non-suspended resolution is cached. A suspension re-checks on
  // every request until the TTL of any earlier entry lapses, and a 401 is never
  // cached at all.
  if (token) writeCached(token, { session, orgId: appUser?.orgId ?? null });

  c.set("user", session.user);
  c.set("session", session.session);
  // Null for a brand-new user with no org yet — ensureUserOrg falls through to its
  // create path in that case.
  c.set("orgId", appUser?.orgId ?? null);
  await next();
});
