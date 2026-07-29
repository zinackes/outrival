import * as cheerio from "cheerio";
import { normalizeHostname } from "@outrival/shared";
import { safeFetch } from "../lib/guarded-fetch";
import { cannyCompanyExists, isCannyHost } from "./canny";
import { matchProductboardPortal } from "./productboard";
import type { RoadmapVendor } from "./types";

/**
 * Find a competitor's public roadmap / feedback portal, cheapest probe first:
 *
 *   1. the URL we were given is already a portal (the user's override wins verbatim);
 *   2. `{brand}.canny.io` — the default Canny address, derivable from the domain and
 *      confirmed by reading the page's state island (Canny 200s on any subdomain);
 *   3. portal subdomains on the competitor's own domain (feedback./roadmap./ideas./
 *      portal.) — where a Canny or ProductBoard custom domain lives;
 *   4. a nav/footer link on the homepage, which is the only way to find a portal on
 *      a bespoke address.
 *
 * Mirrors `docs/discover.ts` in shape (injectable network surface, HEAD-then-GET
 * reachability, soft-404 guard) rather than sharing its helpers: that module's probes
 * are private and docs-tuned, and one discovery policy should not quietly become the
 * contract for another.
 */

const HEAD_TIMEOUT_MS = 5000;
const GET_TIMEOUT_MS = 8000;

// A plain desktop UA for DISCOVERY probes only — some hosts 403 a header-less fetch.
// The capture itself identifies as OutrivalBot.
const PROBE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Portal subdomain conventions on the competitor's own domain, most canonical first. */
const PORTAL_SUBDOMAINS = ["feedback", "roadmap", "ideas", "portal", "feature-requests"];

// Portal vocabulary for a homepage nav/footer link. The href test carries most of the
// weight (a canny.io / productboard.com target is unambiguous); the text test needs a
// roadmap/feedback word, never a bare "product".
const PORTAL_LINK_TEXT = /\b(road\s*map|roadmap|feature\s*requests?|feedback|ideas?\s*portal)\b/i;
const PORTAL_LINK_HREF = /(canny\.io|portal\.productboard\.com|\/(roadmap|feedback|ideas|feature-requests)(\/|$|\?))/i;

export interface RoadmapCandidate {
  url: string;
  /** null when the host doesn't name a vendor — the fetcher identifies it by payload. */
  vendor: RoadmapVendor | null;
  source: "given" | "canny_subdomain" | "subdomain" | "nav" | "footer";
}

/** Injectable network surface, so the whole cascade is testable without sockets. */
export interface RoadmapDiscoverDeps {
  reachable?: (url: string) => Promise<boolean>;
  fetchHtml?: (url: string) => Promise<string | null>;
}

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
      // Some hosts reject HEAD outright (405/501) while serving GET fine.
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
 * Whether `raw` is ALREADY a portal address rather than a site to search from.
 *
 * scrape-monitor passes `monitor.config.url ?? competitor.url`, so this is what makes
 * a user's URL override authoritative: if they pointed us at a specific board, we
 * must read exactly that and not go probing for a different one.
 */
export function looksLikePortalUrl(raw: string): RoadmapVendor | null {
  if (isCannyHost(raw)) return "canny";
  if (matchProductboardPortal(raw)) return "productboard";
  return null;
}

/**
 * First portal link under `selector`, resolved absolute. A link to a vendor host
 * (canny.io / portal.productboard.com) qualifies wherever it points; any OTHER host
 * must share the competitor's registrable domain, so a "roadmap" link to a partner's
 * site can never redirect our monitoring onto a third party. Pure.
 */
export function portalLinkIn(html: string, selector: string, base: URL): string | null {
  const $ = cheerio.load(html);
  const baseDomain = normalizeHostname(base.hostname);
  let found: string | null = null;
  $(selector).each((_, el) => {
    if (found) return;
    const href = $(el).attr("href");
    if (!href) return;
    const text = $(el).text().trim();
    if (!PORTAL_LINK_TEXT.test(text) && !PORTAL_LINK_HREF.test(href)) return;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      return;
    }
    if (abs.protocol !== "https:" && abs.protocol !== "http:") return;
    abs.hash = "";
    const candidate = abs.toString();
    const vendorHosted = looksLikePortalUrl(candidate) !== null;
    if (!vendorHosted && (!baseDomain || normalizeHostname(abs.hostname) !== baseDomain)) return;
    found = candidate;
  });
  return found;
}

export async function discoverRoadmapPortal(
  competitorUrl: string,
  deps: RoadmapDiscoverDeps = {},
): Promise<RoadmapCandidate | null> {
  const given = looksLikePortalUrl(competitorUrl);
  if (given) return { url: competitorUrl, vendor: given, source: "given" };

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

  // `{brand}.canny.io` — the address Canny hands out by default. The brand is the
  // registrable domain's first label (acme.com → acme.canny.io).
  //
  // Canny serves 200 on every subdomain, claimed or not, so this guess is confirmed
  // by the state island and not by reachability. With a HEAD probe EVERY competitor
  // "had" a Canny portal: the steps below never ran, and the phantom page — which
  // parses fine, with no company and no boards — was reported as `portal_private`.
  const brand = domain.split(".")[0];
  if (brand) {
    const cannyUrl = `https://${brand}.canny.io/`;
    const cannyHtml = await fetchHtml(cannyUrl);
    if (cannyHtml !== null && cannyCompanyExists(cannyHtml)) {
      return { url: cannyUrl, vendor: "canny", source: "canny_subdomain" };
    }
  }

  // Portal subdomains on the competitor's own domain — a Canny/ProductBoard custom
  // domain, or a self-hosted portal we'll identify from its payload.
  for (const label of PORTAL_SUBDOMAINS) {
    const candidate = `https://${label}.${domain}/`;
    if (await reachable(candidate)) return { url: candidate, vendor: null, source: "subdomain" };
  }

  // Last resort: one GET of the homepage, for a portal on a bespoke address.
  const homepage = await fetchHtml(base.toString());
  if (homepage === null) return null;
  const nav = portalLinkIn(homepage, "nav a, header a", base);
  if (nav && (await reachable(nav))) {
    return { url: nav, vendor: looksLikePortalUrl(nav), source: "nav" };
  }
  const footer = portalLinkIn(homepage, "footer a", base);
  if (footer && (await reachable(footer))) {
    return { url: footer, vendor: looksLikePortalUrl(footer), source: "footer" };
  }

  return null;
}
