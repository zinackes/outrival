import { realisticHeaders, OUTRIVAL_UA } from "./fingerprint";
import { safeFetch } from "./guarded-fetch";
import { type ScrapeResult } from "./scrape-patchright";
import { isCloudflareChallenge } from "./block-detection";

// L0 — plain HTTP request, no browser, no proxy. The cheapest path. Works on
// SSR/static HTML that isn't IP-blocked. Escalates on:
//   403/503/challenge → IP/anti-bot problem → proxy levels (L2/L3)
//   too little text   → likely a SPA that needs rendering → browser (L1)
export async function scrapeDirect(url: string): Promise<ScrapeResult> {
  const startedAt = Date.now();
  try {
    const res = await safeFetch(url, {
      headers: { ...realisticHeaders(), "User-Agent": OUTRIVAL_UA },
      timeoutMs: 15000,
    });
    const html = await res.text();

    if (res.status === 403 || res.status === 503)
      return {
        ok: false,
        statusCode: res.status,
        failureReason: res.status === 403 ? "blocked_403" : "blocked_503",
        durationMs: Date.now() - startedAt,
      };
    if (isCloudflareChallenge(html))
      return {
        ok: false,
        statusCode: res.status,
        failureReason: "cloudflare_challenge",
        durationMs: Date.now() - startedAt,
      };
    // Any other non-2xx/3xx (404 not-found, 401/451 gated, 410 gone, 429 rate-limit,
    // 5xx) is a dead or invalid target, NOT a SPA that needs rendering. Fail fast and
    // do NOT escalate: burning a browser/proxy on a 404 won't make the page exist,
    // and — the bug this closes — a tiny "Not Found" body would otherwise fall through
    // to the `needs_render` branch, get browser-rendered, and land as a *successful*
    // snapshot of an error page (→ empty pricing/jobs extraction shown as "unknown").
    // Real anti-bot blocks (403/503/challenge) are handled above and keep escalating.
    if (res.status >= 400)
      return {
        ok: false,
        statusCode: res.status,
        failureReason: "http_error",
        durationMs: Date.now() - startedAt,
      };

    // "Enough content" heuristic: otherwise it's probably a SPA shell → escalate
    // to L1 (browser) rather than to a proxy. Strip <script>/<style>/comment
    // CONTENT first: a client-rendered shell (Vite/CRA/Framer) embeds inline GTM
    // + JSON-LD that, counted as "text", tips a visually-empty page past the
    // threshold — so L0 is wrongly accepted and the page is never rendered.
    const textLen = html
      .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim().length;
    if (textLen < 500)
      return { ok: false, statusCode: res.status, failureReason: "needs_render", durationMs: Date.now() - startedAt };

    return {
      ok: true,
      html,
      statusCode: res.status,
      finalUrl: res.url,
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return {
      ok: false,
      failureReason: name === "TimeoutError" ? "timeout" : "network_error",
      durationMs: Date.now() - startedAt,
    };
  }
}
