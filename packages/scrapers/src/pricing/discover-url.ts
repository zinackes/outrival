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
const DIRECT_PATHS = [
  "/pricing",
  "/tarifs",
  "/plans",
  "/price",
  "/prix",
  "/premium",
  "/pricing/",
  "/tarifs/",
  "/plans/",
  "/premium/",
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
      return { url: candidate, source: "direct" };
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

async function isReachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/** A trusted link goes through as-is; an ambiguous one must prove it has prices. */
async function resolveCandidate(match: LinkMatch | null): Promise<string | null> {
  if (!match) return null;
  if (!match.needsVerify) return match.url;
  return (await looksLikePricing(match.url)) ? match.url : null;
}

/**
 * Cheap L0 GET → true when the page shows any pricing signal (a price token, a
 * "contact sales" gate, a calculator, or a signup wall). Used to confirm a
 * tier-branded link before trusting it. Server-rendered pricing (CollX's
 * `/collx-pro`) passes here; JS-only prices won't — but those pages are almost
 * always named "pricing" and take the trusted path instead.
 */
async function looksLikePricing(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": VERIFY_UA, accept: "text/html" },
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const html = await res.text();
    const s = detectPricingSignals(html);
    return s.hasPriceTokens || s.hasGatedKeywords || s.hasCalculator || s.hasSignupWall;
  } catch {
    return false;
  }
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
