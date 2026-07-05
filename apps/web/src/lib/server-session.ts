// Server-only session read shared by the (auth), dashboard and onboarding
// layouts. Not a client module — it forwards the incoming request's cookies to
// the API and is only ever called from Server Components.

const API_URL = process.env.NEXT_PUBLIC_API_URL;

// Better Auth's /get-session returns `{ session, user }` (or null when signed
// out). Kept loose — callers only reach for `user.{id,name,email,twoFactorEnabled}`.
export interface ServerSessionUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  twoFactorEnabled?: boolean;
  [key: string]: unknown;
}
export interface ServerSession {
  user?: ServerSessionUser;
  [key: string]: unknown;
}

const RETRIES = 3;
const BACKOFF_MS = 150;

/**
 * Read the Better Auth session server-side, resilient to transient API hiccups.
 *
 * The (auth) and dashboard layouts redirect in OPPOSITE directions off this
 * value: (auth) bounces a session to /dashboard, /dashboard bounces a null to
 * /auth. So if the underlying fetch flaps between "session" and a *false* null
 * — a cold Neon, an API restarting after a deploy, a 502/503 from the proxy —
 * the two layouts ping-pong the URL between /auth and /dashboard (worst right
 * after sign-up, the first authenticated page hit). Treating a 5xx / network
 * error as "logged out" is the bug; only an authoritative answer settles it:
 *   - a clean 200 (session object, or null body) → that IS the truth,
 *   - a 401/403 → definitively signed out,
 *   - anything else (5xx, network throw) → transient, retried.
 * If every attempt is transiently failing (API genuinely down), we fall back to
 * null so both layouts agree and land on /auth instead of looping.
 */
export async function getServerSession(h: Headers): Promise<ServerSession | null> {
  const url = `${API_URL}/api/auth/get-session`;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: h, cache: "no-store" });
      if (res.status === 401 || res.status === 403) return null;
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as ServerSession | null;
        return body ?? null;
      }
      // 5xx or other unexpected status → transient, retry below.
    } catch {
      // Network error reaching the API → transient, retry below.
    }
    if (attempt < RETRIES - 1) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS * (attempt + 1)));
    }
  }
  return null;
}
