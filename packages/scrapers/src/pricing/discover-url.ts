import * as cheerio from "cheerio";
import { detectPricingSignals } from "./signals";

export interface PricingPageCandidate {
  url: string;
  source: "direct" | "homepage_section" | "nav" | "footer";
}

// A pricing link found on the homepage. `needsVerify` is true when the match
// came only from the ambiguous, tier-branded vocabulary (Pro/Gold/…) — those
// are content-checked before we commit, so "Our products" never masquerades as
// a pricing page.
interface LinkMatch {
  url: string;
  needsVerify: boolean;
}

// Tried in order against the base URL via cheap HEAD probes before we fall
// back to parsing the homepage. FR + EN since the SaaS ecosystem is EN-first
// but Outrival also targets FR sites.
// NB: no "/premium" here on purpose — it's a false-positive magnet (marketing
// `/premium` pages, soft-404 SPA shells that render nothing) and rarely the real
// pricing route. "premium" stays honoured as verified link text/href below, so a
// homepage "Go Premium" → /go-premium link is still found and content-checked.
const DIRECT_PATHS = [
  "/pricing",
  "/tarifs",
  "/plans",
  "/price",
  "/prix",
  "/pricing/",
  "/tarifs/",
  "/plans/",
];

// Unambiguous pricing vocabulary — a match here is trusted without a content
// check. Matches link text or href segments pointing at a pricing page.
const PRICING_LINK = /\b(pricing|tarifs|tarification|plans?|prix|premium)\b/i;
const PRICING_HREF = /(pricing|tarifs|tarification|plans|prix|premium)/i;

// Tier / upgrade vocabulary — consumer apps brand their paid tiers by name
// ("CollX Pro", "CollX Gold", "Discord Nitro") and expose no /pricing route and
// no "pricing" link text. These tokens are ambiguous (`pro` in "products",
// `plus` in "en plus"), so a link matching ONLY here is content-verified before
// use. Word boundaries keep `\bpro\b` off "products"/"professional" while still
// catching "collx-pro" (hyphen is a boundary).
const TIER_TOKEN = /\b(pro|gold|plus|upgrade|subscribe|subscription|membership)\b/i;

// id/class tokens that flag an on-homepage pricing section.
const PRICING_SECTION_ID = /(pricing|tarifs|tarification|plans|prix|premium)/i;

const HEAD_TIMEOUT_MS = 5000;
const VERIFY_TIMEOUT_MS = 8000;
// A pricing hub can list many product pages; cap how many children we verify so a
// hub never turns discovery into a fetch storm.
const MAX_HUB_CHILDREN = 3;
// A plain desktop UA — some sites 403 a header-less fetch of a marketing page.
const VERIFY_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/**
 * Find the "real" pricing page with a cascade: convention URLs first (cheap
 * HEAD probes), then a homepage nav link, then a footer link, then a pricing
 * section embedded in the homepage itself. Tier-branded links (Pro/Gold/…) are
 * accepted only when a cheap fetch confirms the page actually carries pricing
 * signals. Returns null when nothing matches — the caller turns that into an
 * `unknown` status, not an error.
 */
export async function discoverPricingUrl(
  baseUrl: string,
  homepageHtml: string,
): Promise<PricingPageCandidate | null> {
  const base = new URL(baseUrl);

  for (const path of DIRECT_PATHS) {
    const candidate = new URL(path, base).toString();
    if (await isReachable(candidate)) {
      // A reachable convention path can still be a *hub* that lists one pricing
      // page per product with no prices of its own (e.g. Back4App's /pricing →
      // /pricing/backend-as-a-service). Drill to the real product page when so.
      const drilled = await drillPricingHub(candidate);
      return { url: drilled ?? candidate, source: "direct" };
    }
  }

  const nav = await resolveCandidate(pricingLinkIn(homepageHtml, "nav a, header a", base));
  if (nav) return { url: nav, source: "nav" };

  const footer = await resolveCandidate(pricingLinkIn(homepageHtml, "footer a", base));
  if (footer) return { url: footer, source: "footer" };

  if (hasHomepagePricingSection(homepageHtml)) {
    return { url: baseUrl, source: "homepage_section" };
  }

  return null;
}

// A guessed convention path is "reachable" only when a *browser-looking* request
// gets a 2xx that didn't land on an error/not-found shell.
//   - Browser UA: bot-protected SPAs answer a blanket 2xx (e.g. mtgstocks 202s
//     EVERY path) to non-browser requests, which made the first DIRECT_PATH win
//     blindly. Sending VERIFY_UA makes the site route normally instead.
//   - Error-URL guard: SPAs 302 a dead route onto /error/404 (still 200 after the
//     redirect follow); the final `res.url` reveals it. Reject those so discovery
//     falls through to the homepage nav link.
async function isReachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": VERIFY_UA, accept: "text/html" },
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const finalUrl = typeof res.url === "string" && res.url ? res.url : url;
    return !landedOnErrorPage(finalUrl);
  } catch {
    return false;
  }
}

/** True when a URL's path looks like an error / not-found shell (soft-404 redirect target). */
function landedOnErrorPage(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  return /\/(error|404|not[-_]?found)(\/|$)/i.test(path);
}

/**
 * Resolve a homepage pricing link to a committed URL, or null. BOTH kinds are
 * fetched once to confirm the target is actually live: a "trusted" link (text/href
 * literally says "pricing") only has to return 2xx — a 404/dead page is dropped so
 * the caller falls back instead of scraping an error shell (the apex-host `/pricing`
 * 404 bug). An "ambiguous" tier-branded link (Pro/Gold/…) must additionally show
 * real pricing signals. One GET covers both checks.
 */
async function resolveCandidate(match: LinkMatch | null): Promise<string | null> {
  if (!match) return null;
  const html = await fetchHtml(match.url);
  if (html === null) return null; // unreachable / non-2xx (e.g. 404) → drop
  if (!match.needsVerify) return match.url; // trusted + live
  return hasPricingSignals(html) ? match.url : null;
}

/** L0 GET → the page body when reachable (2xx), else null. */
async function fetchHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": VERIFY_UA, accept: "text/html" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** True when the HTML carries any pricing signal (price, gate, calculator, wall). */
function hasPricingSignals(html: string): boolean {
  const s = detectPricingSignals(html);
  return s.hasPriceTokens || s.hasGatedKeywords || s.hasCalculator || s.hasSignupWall;
}

/**
 * Cheap L0 GET → true when the page shows any pricing signal (a price token, a
 * "contact sales" gate, a calculator, or a signup wall). Used to confirm a
 * tier-branded link before trusting it. Server-rendered pricing (CollX's
 * `/collx-pro`) passes here; JS-only prices won't — but those pages are almost
 * always named "pricing" and take the trusted path instead.
 */
async function looksLikePricing(url: string): Promise<boolean> {
  const html = await fetchHtml(url);
  return html !== null && hasPricingSignals(html);
}

/**
 * When a reachable pricing page carries no prices of its own but links to deeper
 * pricing pages, it's a *hub* (e.g. Back4App's /pricing lists a page per product).
 * Fetch it once and drill to the first child that shows prices at L0, else the
 * shallowest child. Returns null — keep the original candidate — when the page is
 * a real pricing page (has signals), is JS-rendered with no children, or exposes
 * only a lone unverifiable child (likelier an incidental sub-link than a hub).
 */
async function drillPricingHub(hubUrl: string): Promise<string | null> {
  const html = await fetchHtml(hubUrl);
  if (html === null || hasPricingSignals(html)) return null;

  const children = deeperPricingLinks(html, hubUrl).slice(0, MAX_HUB_CHILDREN);
  if (children.length === 0) return null;

  for (const child of children) {
    if (await looksLikePricing(child)) return child;
  }
  // No child confirmed prices at L0. Only trust the drill when the page is clearly
  // a hub (several product-pricing children); the browser scrape will render them.
  return children.length >= 2 ? (children[0] ?? null) : null;
}

/** First pricing link inside <nav>/<header>, resolved absolute. Pure. */
export function findNavPricingLink(html: string, base: URL): string | null {
  return pricingLinkIn(html, "nav a, header a", base)?.url ?? null;
}

/** First pricing link inside <footer>, resolved absolute. Pure. */
export function findFooterPricingLink(html: string, base: URL): string | null {
  return pricingLinkIn(html, "footer a", base)?.url ?? null;
}

/** True if the homepage embeds a pricing section (id/class or heading). Pure. */
export function hasHomepagePricingSection(html: string): boolean {
  const $ = cheerio.load(html);
  let found = false;
  $("section, div, [id], [class]").each((_, el) => {
    if (found) return;
    const id = $(el).attr("id") ?? "";
    const cls = $(el).attr("class") ?? "";
    if (PRICING_SECTION_ID.test(id) || PRICING_SECTION_ID.test(cls)) {
      found = true;
    }
  });
  if (found) return true;
  // A heading naming pricing also counts as an on-page section.
  $("h1, h2, h3").each((_, el) => {
    if (found) return;
    if (PRICING_LINK.test($(el).text())) found = true;
  });
  return found;
}

/**
 * Same-origin links that dive DEEPER into pricing than `fromUrl` — a hub page's
 * product-specific pricing children (e.g. /pricing → /pricing/backend-as-a-service).
 * A link qualifies when it stays on the origin and either extends the hub's path
 * (`…/pricing/<child>`) or carries pricing vocabulary in a longer path. Ranked
 * shallowest-first (the most canonical child). Pure.
 */
export function deeperPricingLinks(html: string, fromUrl: string): string[] {
  const from = new URL(fromUrl);
  const fromPath = from.pathname.replace(/\/+$/, ""); // strip trailing slash(es)
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: { url: string; depth: number }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let u: URL;
    try {
      u = new URL(href, from);
    } catch {
      return; // skip malformed href
    }
    if (u.origin !== from.origin) return;
    u.hash = "";
    const path = u.pathname.replace(/\/+$/, "");
    if (path === "" || path === fromPath) return; // root or self
    const isChild = path.startsWith(`${fromPath}/`);
    const isDeeperPricing = PRICING_HREF.test(path) && path.length > fromPath.length;
    if (!isChild && !isDeeperPricing) return;
    const abs = u.toString();
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push({ url: abs, depth: path.split("/").filter(Boolean).length });
  });
  return out.sort((a, b) => a.depth - b.depth).map((x) => x.url);
}

/**
 * First pricing link under `selector`. Prefers a trusted (unambiguous) match;
 * falls back to the first tier-branded link flagged for content verification.
 * Pure — the network verification happens later in `resolveCandidate`.
 */
function pricingLinkIn(html: string, selector: string, base: URL): LinkMatch | null {
  const $ = cheerio.load(html);
  let trusted: string | null = null;
  let ambiguous: string | null = null;
  $(selector).each((_, el) => {
    if (trusted) return; // a trusted match wins outright — stop looking
    const href = $(el).attr("href");
    if (!href) return;
    const text = $(el).text().trim();
    const isTrusted = PRICING_LINK.test(text) || PRICING_HREF.test(href);
    const isTier = TIER_TOKEN.test(text) || TIER_TOKEN.test(href);
    if (!isTrusted && !isTier) return;
    let abs: string;
    try {
      abs = new URL(href, base).toString();
    } catch {
      return; // skip malformed href
    }
    if (isTrusted) trusted = abs;
    else if (!ambiguous) ambiguous = abs; // keep the first tier link as fallback
  });
  if (trusted) return { url: trusted, needsVerify: false };
  if (ambiguous) return { url: ambiguous, needsVerify: true };
  return null;
}
