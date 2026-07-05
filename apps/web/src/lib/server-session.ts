// Server-only fetch helpers shared by the (auth), dashboard and onboarding
// layouts. Not a client module — they forward the incoming request's cookies to
// the API and are only ever called from Server Components.

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
 * Resilient server-side JSON GET forwarding the incoming request's cookies to
 * the API. Layout gates redirect off these reads, so a transient API hiccup —
 * a cold Neon, an API restarting after a deploy, a 502/503 from the proxy,
 * worst on the FIRST authenticated hit right after sign-up — must not be misread
 * as an authoritative answer. Only a definitive response settles it:
 *   - a clean 200 → parsed body (or null when the body itself is null),
 *   - a 401/403 → definitively unauthorized,
 *   - anything else (5xx, network throw) → transient, retried.
 * If every attempt fails (API genuinely down), we fall back to null.
 */
export async function getServerJson<T>(path: string, h: Headers): Promise<T | null> {
  const url = `${API_URL}${path}`;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: h, cache: "no-store" });
      if (res.status === 401 || res.status === 403) return null;
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as T | null;
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

/**
 * Read the Better Auth session server-side, resilient to transient API hiccups.
 *
 * The (auth) and dashboard layouts redirect in OPPOSITE directions off this
 * value: (auth) bounces a session to /dashboard, /dashboard bounces a null to
 * /auth. Reading a transient 5xx / network error as "logged out" would let a
 * cold Neon or a restarting API ping-pong the URL between /auth and /dashboard
 * (worst right after sign-up). getServerJson keeps the read authoritative so
 * the two layouts never flap.
 */
export async function getServerSession(h: Headers): Promise<ServerSession | null> {
  return getServerJson<ServerSession>("/api/auth/get-session", h);
}
