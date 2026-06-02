/**
 * Pure helpers for the SPA runtime-API capture (patch-23). Kept separate from the
 * Patchright-dependent capture so they can be unit-tested and imported without
 * pulling Chromium. The capture observes a pure SPA's XHR/fetch JSON; these
 * helpers pick the calls that actually carry content and turn them into a stable
 * document the normal snapshot → diff → classify pipeline can consume unchanged.
 */

export interface CapturedApiCall {
  url: string;
  method: string;
  status: number;
  contentType: string;
  /** Parsed JSON when valid, else null. */
  body: unknown;
  /** Raw response text, capped by the capturer. */
  rawText: string;
}

export interface CapturedEndpoint {
  url: string;
  method: string;
}

const MIN_BODY = 200;
const MAX_BODY = 100_000;
const CONTENT_KEYS =
  /\b(content|data|items|posts|articles|products|features|pricing|plans|results|entries|nodes)\b/i;
const NOISE_URL = /\b(auth|login|logout|analytics|telemetry|tracking|metrics|ping|beacon|sentry|csrf)\b/i;

/**
 * Keep only the captured calls that look like real content: skip auth/analytics,
 * skip too-short / too-long bodies, and require a JSON object whose keys read like
 * content. Conservative so we don't store a tracking endpoint as a "source".
 */
export function filterRelevantApiCalls(apiCalls: CapturedApiCall[]): CapturedApiCall[] {
  return apiCalls.filter((call) => {
    if (NOISE_URL.test(call.url)) return false;
    if (call.rawText.length < MIN_BODY || call.rawText.length > MAX_BODY) return false;
    if (call.body && typeof call.body === "object") {
      return CONTENT_KEYS.test(JSON.stringify(call.body));
    }
    return false;
  });
}

/** Stable, diff-friendly text of the relevant calls' JSON bodies (newest order). */
export function apiCallsToText(apiCalls: CapturedApiCall[]): string {
  return apiCalls
    .map((c) => `${c.method} ${stripQuery(c.url)}\n${stableStringify(c.body)}`)
    .join("\n\n");
}

/**
 * Wrap the relevant API content in a minimal HTML document. The rest of the
 * pipeline (extractContent → hash → diff → classify) then treats a pure SPA
 * exactly like any other source — no special-casing downstream. Empty when there
 * is no relevant content, which makes the collapse guard fail honestly.
 */
export function apiCallsToHtmlDoc(apiCalls: CapturedApiCall[]): string {
  const text = apiCallsToText(apiCalls);
  if (!text.trim()) return "";
  return `<!doctype html><html><head><title>API capture</title></head><body><pre>${escapeHtml(text)}</pre></body></html>`;
}

/** Deduped endpoint list stored on the monitor for reuse / ops visibility. */
export function toEndpoints(apiCalls: CapturedApiCall[]): CapturedEndpoint[] {
  const seen = new Set<string>();
  const out: CapturedEndpoint[] = [];
  for (const c of apiCalls) {
    const key = `${c.method} ${stripQuery(c.url)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: stripQuery(c.url), method: c.method });
  }
  return out;
}

function stripQuery(url: string): string {
  const i = url.indexOf("?");
  return i === -1 ? url : url.slice(0, i);
}

// Deterministic stringify (sorted keys) so the same response hashes identically
// run to run — volatile key ordering would otherwise look like a change.
function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
        : v,
    ).slice(0, 50_000);
  } catch {
    return "";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
