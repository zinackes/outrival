import { validatePublicUrl } from "@outrival/shared";
import { realisticHeaders, OUTRIVAL_UA } from "./fingerprint";

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
const MAX_REDIRECTS = 5;

export async function quickFetch(url: string): Promise<QuickFetchResult> {
  // SSRF guard: this fetch runs in-process in the API from a user-supplied URL.
  // Redirects are followed MANUALLY so the syntactic host check re-runs on every
  // hop — `redirect: "follow"` would let an initially-safe public host 3xx toward
  // an internal IP (e.g. 169.254.169.254) unchecked. No DNS resolution here, so
  // DNS-rebinding remains an egress-level gap (documented, out of scope).
  let target = url;
  let res: Response;
  for (let hop = 0; ; hop++) {
    const safe = validatePublicUrl(target);
    if (!safe.ok) throw new Error(`quickFetch: unsafe_url (${safe.error})`);
    res = await fetch(target, {
      headers: { ...realisticHeaders(), "User-Agent": OUTRIVAL_UA },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) {
        throw new Error(`quickFetch: too_many_redirects for ${url}`);
      }
      target = new URL(location, target).toString();
      continue;
    }
    break;
  }
  if (!res.ok) {
    throw new Error(`quickFetch: ${res.status} for ${target}`);
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
