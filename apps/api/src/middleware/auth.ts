import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { users } from "@outrival/db";
import { auth } from "../lib/auth";
import { db } from "../lib/db";
import {
  SESSION_CACHE_TTL_MS,
  readCachedSession,
  writeCachedSession,
} from "../lib/session-cache";

// The cache itself, why it exists and what it trades, lives in lib/session-cache.ts.
// It is per-session (keyed off the session token), never per-user: two sessions of
// the same user never share an entry.

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
  const token = SESSION_CACHE_TTL_MS > 0 ? sessionToken(c) : null;
  const cached = token ? readCachedSession(token) : null;

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
  if (token) writeCachedSession(token, { session, orgId: appUser?.orgId ?? null });

  c.set("user", session.user);
  c.set("session", session.session);
  // Null for a brand-new user with no org yet — ensureUserOrg falls through to its
  // create path in that case.
  c.set("orgId", appUser?.orgId ?? null);
  await next();
});
