/**
 * Reddit OAuth app-only auth (userless `client_credentials` grant). Replaces the
 * old unauthenticated www.reddit.com/*.json path, which Reddit now 403s from
 * datacenter IPs. Authenticated requests go to oauth.reddit.com — accepted from a
 * server IP — and stay within the free tier (100 QPM), so no proxy cost. Requires a
 * registered app (reddit.com/prefs/apps) → REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET.
 *
 * The token (~1-24h TTL) is cached in-process and refreshed lazily; a 401 at call
 * site invalidates it via `invalidateRedditToken` + a forced refresh.
 */

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

/** Reddit rejects generic UAs; a descriptive one is required for both token + API. */
export const REDDIT_USER_AGENT =
  "OutrivalBot/1.0 (competitive monitoring; +https://outrival.io)";

let cached: { token: string; expiresAt: number } | null = null;

/** Fetch (or reuse) an app-only bearer token. Throws if creds are unconfigured. */
export async function getRedditToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  // Refresh 60s before expiry to avoid racing a mid-flight 401.
  if (!forceRefresh && cached && cached.expiresAt > now + 60_000) return cached.token;

  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("reddit: REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not configured");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": REDDIT_USER_AGENT,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`reddit token HTTP ${res.status}`);
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("reddit token: no access_token in response");
    const ttlMs = (typeof json.expires_in === "number" ? json.expires_in : 3600) * 1000;
    cached = { token: json.access_token, expiresAt: now + ttlMs };
    return json.access_token;
  } finally {
    clearTimeout(timer);
  }
}

/** Drop the cached token so the next `getRedditToken(true)` re-mints it. */
export function invalidateRedditToken(): void {
  cached = null;
}
