import { validatePublicUrl } from "@outrival/shared";
import { realisticHeaders, realisticUserAgent } from "./fingerprint";

const MIN_USABLE_LENGTH = 100;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface QuickFetchResult {
  html: string; // raw response body
  text: string; // stripped visible text
}

/**
 * Lightweight fetch for the API (onboarding URL analysis). Plain HTTP only —
 * deliberately no browser/proxy so the `@outrival/scrapers/quick-fetch` subpath
 * stays free of Patchright/Crawlee and the API process stays small. A protected
 * or SPA-only site that returns too little text throws; the full L0→L4 cascade
 * runs worker-side once monitors are seeded. Returns raw HTML too so the caller
 * can run cheerio-based helpers (e.g. pricing-page discovery) on the same fetch.
 */
export async function quickFetch(url: string): Promise<QuickFetchResult> {
  // SSRF guard: this fetch runs in-process in the API from a user-supplied URL.
  // Syntactic host check (no DNS); `redirect: follow` below means a public host
  // could still 3xx toward an internal IP — residual gap covered at egress.
  const safe = validatePublicUrl(url);
  if (!safe.ok) throw new Error(`quickFetch: unsafe_url (${safe.error})`);
  const res = await fetch(url, {
    headers: { ...realisticHeaders(), "User-Agent": realisticUserAgent() },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`quickFetch: ${res.status} for ${url}`);
  }
  const html = await res.text();
  const text = stripHtml(html);
  if (text.length < MIN_USABLE_LENGTH) {
    throw new Error(`quickFetch: too little content for ${url} (needs rendering)`);
  }
  return { html, text };
}

/** Text-only convenience over {@link quickFetch}; same throw contract. */
export async function quickFetchText(url: string): Promise<string> {
  return (await quickFetch(url)).text;
}
