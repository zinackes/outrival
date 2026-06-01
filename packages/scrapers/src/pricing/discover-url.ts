import * as cheerio from "cheerio";

export interface PricingPageCandidate {
  url: string;
  source: "direct" | "homepage_section" | "nav" | "footer";
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
  "/pricing/",
  "/tarifs/",
  "/plans/",
];

// Matches link text or href segments pointing at a pricing page.
const PRICING_LINK = /\b(pricing|tarifs|tarification|plans?|prix)\b/i;
const PRICING_HREF = /(pricing|tarifs|tarification|plans|prix)/i;

// id/class tokens that flag an on-homepage pricing section.
const PRICING_SECTION_ID = /(pricing|tarifs|tarification|plans|prix)/i;

const HEAD_TIMEOUT_MS = 5000;

/**
 * Find the "real" pricing page with a cascade: convention URLs first (cheap
 * HEAD probes), then a homepage nav link, then a footer link, then a pricing
 * section embedded in the homepage itself. Returns null when nothing matches —
 * the caller turns that into an `unknown` status, not an error.
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

  const navMatch = findNavPricingLink(homepageHtml, base);
  if (navMatch) return { url: navMatch, source: "nav" };

  const footerMatch = findFooterPricingLink(homepageHtml, base);
  if (footerMatch) return { url: footerMatch, source: "footer" };

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

/** First pricing link found inside <nav>/<header>, resolved absolute. Pure. */
export function findNavPricingLink(html: string, base: URL): string | null {
  return firstPricingLinkIn(html, "nav a, header a", base);
}

/** First pricing link found inside <footer>, resolved absolute. Pure. */
export function findFooterPricingLink(html: string, base: URL): string | null {
  return firstPricingLinkIn(html, "footer a", base);
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

function firstPricingLinkIn(html: string, selector: string, base: URL): string | null {
  const $ = cheerio.load(html);
  let match: string | null = null;
  $(selector).each((_, el) => {
    if (match) return;
    const href = $(el).attr("href");
    if (!href) return;
    const text = $(el).text().trim();
    if (PRICING_LINK.test(text) || PRICING_HREF.test(href)) {
      try {
        match = new URL(href, base).toString();
      } catch {
        /* skip malformed href */
      }
    }
  });
  return match;
}
