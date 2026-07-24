import * as cheerio from "cheerio";
import { normalizeHostname } from "@outrival/shared";
import { safeFetch } from "../lib/guarded-fetch";

/**
 * Docs-root discovery for the `docs` source. Cheapest-first cascade: developer
 * subdomains → conventional paths → a nav/footer link on the homepage (one L0 GET,
 * only reached when the cheap probes all miss).
 *
 * The reachability probes mirror `pricing/discover-url.ts` (HEAD, GET fallback on a
 * method restriction, soft-404 guard) but are re-implemented here on purpose: that
 * module's helpers are private and pricing-tuned, and growing a second caller into
 * them would couple two unrelated discovery policies.
 */

const HEAD_TIMEOUT_MS = 5000;
const GET_TIMEOUT_MS = 8000;

// A plain desktop UA — some docs hosts 403 a header-less fetch of a marketing page.
// The actual capture goes through the cascade (identified OutrivalBot UA); this is
// discovery only.
const PROBE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Developer-docs subdomain conventions, most canonical first. */
const DOCS_SUBDOMAINS = ["docs", "developers", "developer", "api", "apidocs", "devdocs"];

/** Conventional docs paths on the competitor's own origin, most canonical first. */
const DOCS_PATHS = [
  "/docs",
  "/documentation",
  "/api-reference",
  "/api-docs",
  "/reference",
  "/developers",
  "/developer",
  "/api",
];

// Docs vocabulary for a homepage nav/footer link. Requires an explicit docs word:
// a bare "API" in body copy is far too loose, but "API reference" / "API docs" /
// "Developers" in a nav is unambiguous.
const DOCS_LINK_TEXT =
  /\b(docs|documentation|api\s*reference|api\s*docs|developer\s*(docs|portal|hub)|developers)\b/i;
const DOCS_LINK_HREF = /(\/|\.)(docs|documentation|api-reference|api-docs|developers?|reference)(\/|$|\?)/i;

export type DocsRootSource = "given" | "subdomain" | "path" | "nav" | "footer";

export interface DocsRoot {
  url: string;
  source: DocsRootSource;
}

/** Injectable network surface, so the whole cascade is testable without sockets. */
export interface DiscoverDeps {
  /** HEAD/GET reachability probe. */
  reachable?: (url: string) => Promise<boolean>;
  /** L0 GET → body, or null when unreachable / non-2xx. */
  fetchHtml?: (url: string) => Promise<string | null>;
}

/** True when a URL's path looks like an error / not-found shell (soft-404 target). */
function landedOnErrorPage(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  return /\/(error|404|not[-_]?found)(\/|$)/i.test(path);
}

async function defaultFetchHtml(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      timeoutMs: GET_TIMEOUT_MS,
      headers: { "user-agent": PROBE_UA, accept: "text/html" },
    });
    if (!res.ok) return null;
    const finalUrl = typeof res.url === "string" && res.url ? res.url : url;
    if (landedOnErrorPage(finalUrl)) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function defaultReachable(url: string): Promise<boolean> {
  try {
    const res = await safeFetch(url, {
      method: "HEAD",
      timeoutMs: HEAD_TIMEOUT_MS,
      headers: { "user-agent": PROBE_UA, accept: "text/html" },
    });
    if (!res.ok) {
      // Some servers reject HEAD outright (405/501) while serving GET fine — a method
      // restriction must not hide a real docs site. Any other non-2xx is a real miss.
      if (res.status !== 405 && res.status !== 501) return false;
      return (await defaultFetchHtml(url)) !== null;
    }
    const finalUrl = typeof res.url === "string" && res.url ? res.url : url;
    return !landedOnErrorPage(finalUrl);
  } catch {
    return false;
  }
}

/**
 * First docs link under `selector`, resolved absolute. Only same-registrable-domain
 * links qualify: a competitor's docs live on their own eTLD+1 (docs.acme.com,
 * acme.com/docs), and following an off-domain "documentation" link would monitor a
 * third party. Pure.
 */
export function docsLinkIn(html: string, selector: string, base: URL): string | null {
  const $ = cheerio.load(html);
  const baseDomain = normalizeHostname(base.hostname);
  let found: string | null = null;
  $(selector).each((_, el) => {
    if (found) return;
    const href = $(el).attr("href");
    if (!href) return;
    const text = $(el).text().trim();
    if (!DOCS_LINK_TEXT.test(text) && !DOCS_LINK_HREF.test(href)) return;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      return;
    }
    if (abs.protocol !== "https:" && abs.protocol !== "http:") return;
    if (!baseDomain || normalizeHostname(abs.hostname) !== baseDomain) return;
    abs.hash = "";
    found = abs.toString();
  });
  return found;
}

/**
 * Whether a URL is ALREADY a docs surface rather than a site root to search from.
 *
 * scrape-monitor hands the scraper `monitor.config.url ?? competitor.url`, so this is
 * how the user's optional URL override wins: if they pointed us at their competitor's
 * docs, we must monitor exactly that, not go probing `docs.<domain>` and silently
 * monitor a different surface. Also correct for API-first companies whose site root
 * genuinely is `api.acme.com`. Pure.
 */
export function looksLikeDocsUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const firstLabel = u.hostname.split(".")[0]?.toLowerCase() ?? "";
  if (DOCS_SUBDOMAINS.includes(firstLabel)) return true;
  const path = u.pathname.replace(/\/+$/, "");
  if (!path) return false;
  return DOCS_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Resolve the competitor's docs root, or null when they publish none. A URL that is
 * already a docs surface (see {@link looksLikeDocsUrl}) is returned verbatim, which is
 * what makes the user's URL override authoritative.
 */
export async function discoverDocsRoot(
  competitorUrl: string,
  deps: DiscoverDeps = {},
): Promise<DocsRoot | null> {
  if (looksLikeDocsUrl(competitorUrl)) return { url: competitorUrl, source: "given" };

  const reachable = deps.reachable ?? defaultReachable;
  const fetchHtml = deps.fetchHtml ?? defaultFetchHtml;

  let base: URL;
  try {
    base = new URL(competitorUrl);
  } catch {
    return null;
  }
  const domain = normalizeHostname(base.hostname);
  if (!domain) return null;

  for (const label of DOCS_SUBDOMAINS) {
    const candidate = `https://${label}.${domain}/`;
    if (await reachable(candidate)) return { url: candidate, source: "subdomain" };
  }

  for (const path of DOCS_PATHS) {
    const candidate = new URL(path, base.origin).toString();
    if (await reachable(candidate)) return { url: candidate, source: "path" };
  }

  // Last resort: the homepage's own nav/footer. One GET, and only when everything
  // conventional missed — a docs site under a bespoke route (/guides, /handbook)
  // is only ever discoverable this way.
  const homepage = await fetchHtml(base.toString());
  if (homepage === null) return null;
  const nav = docsLinkIn(homepage, "nav a, header a", base);
  if (nav && (await reachable(nav))) return { url: nav, source: "nav" };
  const footer = docsLinkIn(homepage, "footer a", base);
  if (footer && (await reachable(footer))) return { url: footer, source: "footer" };

  return null;
}
