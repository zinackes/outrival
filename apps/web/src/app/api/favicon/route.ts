import type { NextRequest } from "next/server";

// Self-hosted favicon proxy. The browser only ever hits this same-origin route —
// the list of monitored competitors never leaks to a third party. Server-side we
// resolve the icon from public favicon services (Google first for quality, then
// DuckDuckGo as a failover) and cache the bytes. On total failure we return 404
// so <CompAvatar> falls back to the initial letter.

export const runtime = "nodejs";

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ENTRIES = 500;
const FETCH_TIMEOUT_MS = 4000;

// Process-local cache (per server instance) on top of the browser/CDN cache, so a
// hot domain rendered across many avatars is fetched upstream at most once / TTL.
const cache = new Map<string, { body: ArrayBuffer; type: string; at: number }>();

function normalizeDomain(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  let host: string;
  try {
    host = new URL(s.includes("://") ? s : `https://${s}`).hostname;
  } catch {
    return null;
  }
  // A real registrable domain only. Rejects localhost / *.local / bare IPs — both
  // useless to the favicon services and a defense-in-depth guard (though we only
  // ever interpolate this into trusted Google/DDG URLs, so there's no SSRF here).
  if (
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".local") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  ) {
    return null;
  }
  return host.replace(/^www\./, "");
}

function sources(domain: string): string[] {
  const d = encodeURIComponent(domain);
  return [
    `https://www.google.com/s2/favicons?domain=${d}&sz=64`,
    `https://icons.duckduckgo.com/ip3/${d}.ico`,
  ];
}

function iconResponse(body: ArrayBuffer, type: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": type,
      // Favicons are effectively static — cache hard in the browser and any CDN.
      "Cache-Control": "public, max-age=604800, s-maxage=604800, immutable",
    },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const raw =
    req.nextUrl.searchParams.get("domain") ??
    req.nextUrl.searchParams.get("url");
  const domain = raw ? normalizeDomain(raw) : null;
  if (!domain) return new Response(null, { status: 400 });

  const cached = cache.get(domain);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return iconResponse(cached.body, cached.type);
  }

  for (const src of sources(domain)) {
    try {
      const res = await fetch(src, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
      });
      if (!res.ok) continue;
      const body = await res.arrayBuffer();
      if (body.byteLength === 0) continue;
      const type = res.headers.get("content-type") ?? "image/x-icon";
      if (cache.size >= MAX_ENTRIES) cache.clear();
      cache.set(domain, { body, type, at: Date.now() });
      return iconResponse(body, type);
    } catch {
      // Try the next source; a total miss falls through to the 404 below.
    }
  }

  return new Response(null, { status: 404 });
}
