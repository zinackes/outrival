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
  /**
   * Reachability probe. Returns the URL the probe LANDED on (after redirects), or
   * null when unreachable. The landing URL rather than a boolean because a docs
   * subdomain is very often a redirect: `docs.trigger.dev` serves `trigger.dev/docs`,
   * `docs.anthropic.com` serves `platform.claude.com/docs`. Recording the probed
   * hostname as the root made `filterDocsUrls` drop every URL in the docs sitemap
   * (they carry the landing host), so 303 real pages read as no index at all.
   */
  reachable?: (url: string) => Promise<string | null>;
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

async function defaultReachable(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      method: "HEAD",
      timeoutMs: HEAD_TIMEOUT_MS,
      headers: { "user-agent": PROBE_UA, accept: "text/html" },
    });
    if (!res.ok) {
      // Some servers reject HEAD outright (405/501) while serving GET fine — a method
      // restriction must not hide a real docs site. Any other non-2xx is a real miss.
      if (res.status !== 405 && res.status !== 501) return null;
      return (await defaultFetchHtml(url)) === null ? null : url;
    }
    const finalUrl = typeof res.url === "string" && res.url ? res.url : url;
    return landedOnErrorPage(finalUrl) ? null : finalUrl;
  } catch {
    return null;
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

/** Path segments that name a docs surface — DOCS_PATHS without their leading slash. */
const DOCS_SEGMENTS = new Set(DOCS_PATHS.map((p) => p.slice(1)));

/**
 * The docs ROOT a probe's landing URL implies, or null when the landing is not a docs
 * surface at all. Two jobs, both load-bearing:
 *
 *   1. Re-root after a redirect. `docs.trigger.dev` lands on
 *      `trigger.dev/docs/introduction` and `docs.anthropic.com` on
 *      `platform.claude.com/docs/en/home`. Keeping the probed hostname as the root
 *      meant the docs sitemap — which lists the LANDING host — was filtered to zero
 *      and the source failed `no_docs_index` while holding hundreds of real pages.
 *      The landing PAGE isn't the root either, so the path is cut back to the docs
 *      segment: `/docs/introduction` → `/docs`.
 *   2. Reject a parked subdomain. `docs.sendible.com` lands on `www.sendible.com/` —
 *      a marketing home. Today that becomes the docs root and its site-wide sitemap
 *      is offered as documentation. No docs segment, no docs host ⇒ null, and the
 *      cascade moves on (ending in `no_docs_surface`, a neutral absence, instead of
 *      `no_docs_index`, a failure nobody can fix).
 *
 * Pure.
 */
export function docsRootFromLanding(landing: string): string | null {
  let u: URL;
  try {
    u = new URL(landing);
  } catch {
    return null;
  }
  // A docs subdomain qualifies whole: every path on it is documentation.
  const firstLabel = u.hostname.split(".")[0]?.toLowerCase() ?? "";
  if (DOCS_SUBDOMAINS.includes(firstLabel)) return `${u.origin}/`;
  // Otherwise the root is the shortest prefix ending in a docs segment. Scanning for
  // the segment rather than matching the path's start is what keeps a localised docs
  // site (`/en/docs/quickstart` → `/en/docs`) discoverable.
  const segments = u.pathname.split("/").filter(Boolean);
  const idx = segments.findIndex((s) => DOCS_SEGMENTS.has(s.toLowerCase()));
  if (idx === -1) return null;
  return `${u.origin}/${segments.slice(0, idx + 1).join("/")}`;
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

  // The conventional rungs are GUESSES, so they have to survive where they land: a
  // subdomain or a path that redirects somewhere with no docs shape was never a docs
  // surface, it was a parking redirect that happened to answer 200.
  for (const label of DOCS_SUBDOMAINS) {
    const landed = await reachable(`https://${label}.${domain}/`);
    const root = landed ? docsRootFromLanding(landed) : null;
    if (root) return { url: root, source: "subdomain" };
  }

  for (const path of DOCS_PATHS) {
    const landed = await reachable(new URL(path, base.origin).toString());
    const root = landed ? docsRootFromLanding(landed) : null;
    if (root) return { url: root, source: "path" };
  }

  // Last resort: the homepage's own nav/footer. One GET, and only when everything
  // conventional missed — a docs site under a bespoke route (/guides, /handbook)
  // is only ever discoverable this way. A NAMED link is evidence in itself, so the
  // docs shape isn't required here: the landing wins when it has one, the link
  // stands on its own when it doesn't.
  const homepage = await fetchHtml(base.toString());
  if (homepage === null) return null;
  for (const [selector, source] of [
    ["nav a, header a", "nav"],
    ["footer a", "footer"],
  ] as const) {
    const link = docsLinkIn(homepage, selector, base);
    if (!link) continue;
    const landed = await reachable(link);
    if (landed) return { url: docsRootFromLanding(landed) ?? landed, source };
  }

  return null;
}
