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

// The three ways a server-side gate read can settle. The distinction matters:
// a layout must redirect off a DEFINITIVE answer only. An "indeterminate" read
// (the API never gave a clean 200/401/403 — cold Neon, a restarting API, a
// 502/503 from the proxy) is NOT an authoritative "logged out", and treating it
// as one is exactly what lets /dashboard and /auth ping-pong the URL forever.
type FetchOutcome<T> =
  | { state: "ok"; data: T | null } // a clean 200 (body may itself be null)
  | { state: "unauthorized" } // 401/403 — definitively signed out
  | { state: "indeterminate" }; // every attempt failed transiently

/**
 * Resilient server-side JSON GET forwarding the incoming request's cookies to
 * the API, surfacing WHY it settled the way it did. Layout gates redirect off
 * these reads, so a transient API hiccup — a cold Neon, an API restarting after
 * a deploy, a 502/503 from the proxy, worst on the FIRST authenticated hit right
 * after sign-up — must be distinguishable from an authoritative answer:
 *   - a clean 200 → { ok, data } (data is null when the body itself is null),
 *   - a 401/403 → { unauthorized },
 *   - anything else (5xx, network throw), retried, then → { indeterminate }.
 */
async function fetchJsonOutcome<T>(path: string, h: Headers): Promise<FetchOutcome<T>> {
  const url = `${API_URL}${path}`;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: h, cache: "no-store" });
      if (res.status === 401 || res.status === 403) return { state: "unauthorized" };
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as T | null;
        return { state: "ok", data };
      }
      // 5xx or other unexpected status → transient, retry below.
    } catch {
      // Network error reaching the API → transient, retry below.
    }
    if (attempt < RETRIES - 1) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS * (attempt + 1)));
    }
  }
  return { state: "indeterminate" };
}

/**
 * Back-compat helper: collapses the outcome to `T | null`. Callers that only
 * gate softly (e.g. the onboarding-status read, which fails open by design) keep
 * their existing single-value contract — indeterminate and unauthorized both map
 * to null, exactly as before.
 */
export async function getServerJson<T>(path: string, h: Headers): Promise<T | null> {
  const outcome = await fetchJsonOutcome<T>(path, h);
  return outcome.state === "ok" ? outcome.data : null;
}

// The session read's three states, exposed so the (auth)/dashboard/onboarding
// gates can redirect on a DEFINITIVE answer only and hold on an indeterminate one.
export type SessionOutcome =
  | { state: "authenticated"; session: ServerSession }
  | { state: "unauthenticated" } // API said no session (200+null body, or 401/403)
  | { state: "indeterminate" }; // API never answered cleanly — do NOT bounce to /auth

/**
 * Read the Better Auth session server-side, surfacing whether "no session" is
 * authoritative or merely a transient failure.
 *
 * The (auth) and dashboard layouts redirect in OPPOSITE directions off this
 * value: (auth) bounces a session to /dashboard, /dashboard bounces "no session"
 * to /auth. If /dashboard reads a transient failure as "logged out" it redirects
 * to /auth, which reads the (now warm) session and redirects back — the URL
 * flaps between the two forever. Returning "indeterminate" lets /dashboard hold
 * instead of bouncing, which is the only way to break that loop at its root.
 */
export async function getSessionOutcome(h: Headers): Promise<SessionOutcome> {
  const outcome = await fetchJsonOutcome<ServerSession>("/api/auth/get-session", h);
  if (outcome.state === "indeterminate") return { state: "indeterminate" };
  // A clean 200 with a null body, or a 401/403, are both authoritative "no session".
  if (outcome.state === "unauthorized" || !outcome.data?.user) {
    return { state: "unauthenticated" };
  }
  return { state: "authenticated", session: outcome.data };
}

/**
 * Back-compat helper returning `ServerSession | null`. Used by gates that only
 * ever redirect TOWARD /dashboard (the (auth) layout), where holding on an
 * indeterminate read is the same safe outcome as null: render the login page.
 */
export async function getServerSession(h: Headers): Promise<ServerSession | null> {
  const outcome = await getSessionOutcome(h);
  return outcome.state === "authenticated" ? outcome.session : null;
}
