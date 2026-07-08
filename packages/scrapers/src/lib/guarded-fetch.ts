import { validatePublicUrl } from "@outrival/shared";

const MAX_REDIRECTS = 5;

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * SSRF-safe fetch for URLs derived from scraped/competitor-controlled content.
 * Validates every hop with validatePublicUrl and follows redirects MANUALLY so an
 * initially-public host can't 3xx toward an internal IP (e.g. 169.254.169.254).
 * Throws on an unsafe URL or too many redirects; returns the final Response (which
 * may be !ok — callers decide). No DNS resolution here, so DNS-rebinding remains an
 * egress-level gap (documented, out of scope).
 */
export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
  let target = url;
  for (let hop = 0; ; hop++) {
    const safe = validatePublicUrl(target);
    if (!safe.ok) throw new Error(`safeFetch: unsafe_url (${safe.error})`);
    const res = await fetch(target, {
      method: opts.method,
      headers: opts.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new Error(`safeFetch: too_many_redirects for ${url}`);
      target = new URL(location, target).toString();
      continue;
    }
    return res;
  }
}
