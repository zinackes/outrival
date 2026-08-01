import * as cheerio from "cheerio";
import { classifyLogoName, normalizeCustomerName } from "@outrival/shared";

/**
 * Reading a competitor's integration catalog (Content Intelligence v2 P5).
 *
 * `partnerships` has been a signal category since the taxonomy rewrite and nothing
 * fed it directly: a competitor shipping a Salesforce connector only surfaced if a
 * blog post happened to mention it. The catalog page is where that is published
 * first, and it is published as a LIST — the same shape the customers registry
 * already solved, so this module is deliberately its twin.
 *
 * Two readings, cheapest first:
 *
 *  - THE SITEMAP. We already walk every competitor's sitemap weekly. A URL of the
 *    form /integrations/<slug> IS an integration listing, and reading the slug costs
 *    nothing at all: no fetch, no parse, no model.
 *  - THE INDEX PAGE. A catalog that renders its tiles without giving each one a URL
 *    is invisible to the sitemap, so the index itself is read — conservatively.
 *
 * "Conservatively" is the whole design of the second reading. A name is kept only
 * when the page states it as a name: the alt text of a tile logo, or the text of a
 * link that goes into the catalog. Anything else (a heading that could be a section,
 * a paragraph that mentions a vendor) is dropped. A false name here does not just
 * render badly — it enters a permanent registry and raises "they added an
 * integration", so silence is the correct output whenever the page is ambiguous.
 *
 * PURE: no I/O, no DB, no AI.
 */

/**
 * Paths probed once, in order, to find a catalog. Short by design: a handful of GETs
 * against someone else's site, not a crawl.
 *
 * `/partners` is NOT probed. A bare partners page is a partner PROGRAMME — "become a
 * reseller", tiers, a contact form — and reading it as a catalog would file the
 * programme's own vocabulary as integrations. A partner page with a child slug
 * (/partners/acme) is a directory entry and is read through the sitemap route below.
 */
export const INTEGRATION_INDEX_PATHS: readonly string[] = [
  "/integrations",
  "/integrations/",
  "/marketplace",
  "/apps",
  "/integrationen",
  "/integraciones",
];

/**
 * The catalog sections a child slug can hang off. `/apps` and `/marketplace` are as
 * common as `/integrations` (Slack, Shopify, Atlassian all use one of the three),
 * and the singular is included because plenty of sites write `/integration/slack`.
 */
const INTEGRATION_SECTION_RE =
  /\/(?:integrations?|integrationen|integraciones|marketplace|app-?(?:directory|store)|apps|partners?|partenaires|partnern?)\/([^/?#]+)\/?$/i;

/**
 * Slugs that are catalog CHROME, not an integration: pagination, category pages, the
 * programme's own funnel. Each of these would otherwise enter the registry as a
 * brand called "Become A Partner".
 */
const NON_BRAND_SLUGS = new Set([
  "all",
  "apply",
  "become-a-partner",
  "become-a-reseller",
  "browse",
  "categories",
  "category",
  "contact",
  "directory",
  "faq",
  "featured",
  "index",
  "list",
  "login",
  "new",
  "overview",
  "page",
  "partner-program",
  "partners",
  "pricing",
  "program",
  "programme",
  "register",
  "request",
  "search",
  "signup",
  "sign-up",
  "submit",
  "tags",
  "types",
]);

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** A name lifted off the catalog, in the page's own casing. */
export interface IntegrationNameHit {
  /** As the page wrote it, or the slug title-cased when the URL is all we have. */
  displayName: string;
  /** The registry key — the SAME normaliser the customer registry uses, so a name
   *  read off a slug and the same name read off a tile are one integration. */
  nameNormalized: string;
  /** The page that names it: the catalog, or the integration's own listing. */
  evidenceUrl: string;
}

/**
 * The integration a catalog URL names, or null.
 *
 * Slug only, and only under a section that IS a catalog. "/integrations/slack" is
 * Slack; "/integrations" is the catalog itself; "/blog/why-we-love-slack" is a post.
 * A slug that reads as chrome, as a file, or as a sentence is dropped — a catalog
 * entry is a product name, and a product name is short.
 */
export function integrationFromUrl(url: string): IntegrationNameHit | null {
  const match = INTEGRATION_SECTION_RE.exec(pathOf(url));
  const rawSlug = match?.[1];
  if (!rawSlug) return null;

  const slug = decodeURIComponent(rawSlug).toLowerCase();
  if (NON_BRAND_SLUGS.has(slug)) return null;
  // A file, a paginated page, or a slug so long it is a sentence rather than a name.
  if (/\.(?:html?|php|aspx?|json|xml)$/i.test(slug)) return null;
  if (/^\d+$/.test(slug)) return null;
  if (slug.length > 60) return null;
  const words = slug.split("-").filter(Boolean);
  if (words.length === 0 || words.length > 5) return null;

  const displayName = titleCaseSlug(words);
  const verdict = classifyLogoName(displayName);
  if (verdict.kind !== "brand") return null;
  const nameNormalized = normalizeCustomerName(verdict.name);
  if (!nameNormalized) return null;
  return { displayName: verdict.name, nameNormalized, evidenceUrl: url };
}

/**
 * "microsoft-teams" → "Microsoft Teams". The trailing "-integration" / "-app" that
 * many catalogs append to their own slugs is dropped: it names our own section, not
 * the vendor, and keeping it would file "Slack" and "Slack Integration" as two.
 */
function titleCaseSlug(words: string[]): string {
  const trimmed = [...words];
  while (trimmed.length > 1) {
    const last = trimmed[trimmed.length - 1] as string;
    if (["integration", "integrations", "app", "connector", "plugin"].includes(last)) {
      trimmed.pop();
      continue;
    }
    break;
  }
  return trimmed.map((w) => (w.length <= 2 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1))).join(" ");
}

/** Every integration named by a set of URLs, deduped on the registry key. */
export function integrationsFromUrls(urls: ReadonlyArray<string>): IntegrationNameHit[] {
  const out: IntegrationNameHit[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const hit = integrationFromUrl(url);
    if (!hit || seen.has(hit.nameNormalized)) continue;
    seen.add(hit.nameNormalized);
    out.push(hit);
  }
  return out;
}

// Site chrome: the same exclusion the customers reader uses, so the two readings of
// a logo can never disagree about what counts as one.
const CHROME_SEL =
  'header, nav, footer, [class*="header" i], [class*="navbar" i], [class*="footer" i], [class*="testimonial" i], [class*="quote" i], [class*="review" i], [class*="rating" i], [class*="avatar" i]';

/** An alt that is a URL or a file name is a logo with no alt text at all. */
function looksLikeAsset(s: string): boolean {
  return /^https?:\/\//i.test(s) || /\.(png|jpe?g|svg|webp|gif)(\?|$)/i.test(s) || s.includes("/");
}

/** Tiles read per catalog page. Past this it is paginating, not listing. */
export const MAX_TILES_PER_PAGE = 120;

/**
 * The integrations a catalog page names.
 *
 * TWO evidence shapes, and nothing else:
 *  - a link that goes INTO the catalog, whose own text names the tile;
 *  - the alt text of an image on the page, brand-classified.
 *
 * A heading is deliberately not read on its own. Catalog pages head their sections
 * ("Popular", "CRM", "All integrations") in exactly the markup a tile title uses, so
 * reading headings would file those section names as vendors — permanently, and with
 * an alert attached. When in doubt, this returns nothing.
 */
export function parseIntegrationTiles(html: string, baseUrl: string): IntegrationNameHit[] {
  const $ = cheerio.load(html);
  const base = hostOf(baseUrl);
  const hits: IntegrationNameHit[] = [];
  const seen = new Set<string>();

  const push = (hit: IntegrationNameHit | null) => {
    if (!hit || seen.has(hit.nameNormalized) || hits.length >= MAX_TILES_PER_PAGE) return;
    seen.add(hit.nameNormalized);
    hits.push(hit);
  };

  // 1. Links into the catalog. The URL proves it is a listing; the link text is the
  //    name the page chose for it, which beats a slug where the two disagree.
  $("a[href]").each((_, el) => {
    if (hits.length >= MAX_TILES_PER_PAGE) return;
    const $el = $(el);
    if ($el.closest(CHROME_SEL).length) return;
    const raw = ($el.attr("href") ?? "").trim();
    if (!raw || raw.startsWith("#") || raw.toLowerCase().startsWith("javascript:")) return;
    let resolved: string;
    try {
      const u = new URL(raw, baseUrl);
      u.hash = "";
      u.search = "";
      resolved = u.toString();
    } catch {
      return;
    }
    if (hostOf(resolved) !== base) return;
    const fromUrl = integrationFromUrl(resolved);
    if (!fromUrl) return;

    const text = ($el.text() ?? "").replace(/\s+/g, " ").trim();
    // A tile's link text is a product name. A sentence is a card description that
    // happens to wrap the whole tile, so the slug is the better reading.
    if (text && text.length <= 40 && text.split(/\s+/).length <= 5) {
      const verdict = classifyLogoName(text);
      if (verdict.kind === "brand") {
        const nameNormalized = normalizeCustomerName(verdict.name);
        if (nameNormalized) {
          push({ displayName: verdict.name, nameNormalized, evidenceUrl: resolved });
          return;
        }
      }
    }
    push(fromUrl);
  });

  // 2. Tile logos. Same rule as the customers wall: alt text or nothing.
  $("img[alt]").each((_, el) => {
    if (hits.length >= MAX_TILES_PER_PAGE) return;
    const $el = $(el);
    if ($el.closest(CHROME_SEL).length) return;
    const alt = ($el.attr("alt") ?? "").replace(/\s+/g, " ").trim();
    if (!alt || alt.length > 60 || looksLikeAsset(alt)) return;
    const verdict = classifyLogoName(alt);
    if (verdict.kind !== "brand") return;
    const nameNormalized = normalizeCustomerName(verdict.name);
    if (!nameNormalized) return;
    push({ displayName: verdict.name, nameNormalized, evidenceUrl: baseUrl });
  });

  return hits;
}

// What a catalog calls itself, in its <title> or its first headings.
const INTEGRATIONS_HEADING_RE =
  /\b(integrations?|integrationen|integraciones|int[ée]grations?|marketplace|app (?:directory|store|marketplace)|connectors?|add-?ons?|plugins?)\b/i;

/**
 * Is this page really an integration catalog, or a redirect that answered 200?
 *
 * A probe walks guessed paths, and a site that serves its homepage for every unknown
 * path answers 200 with a page full of logos — which is what we came for, so counting
 * logos alone cannot tell the two apart. A catalog NAMES itself in its title or a
 * heading; a homepage does not. Both signals are required: the name, and something to
 * read.
 */
export function looksLikeIntegrationsIndex(html: string, url: string): boolean {
  const $ = cheerio.load(html);
  const title = ($("title").first().text() || "").replace(/\s+/g, " ").trim();
  const headings = $("h1, h2")
    .slice(0, 5)
    .map((_, el) => $(el).text())
    .get()
    .join(" ");
  if (!INTEGRATIONS_HEADING_RE.test(title) && !INTEGRATIONS_HEADING_RE.test(headings)) return false;
  return parseIntegrationTiles(html, url).length >= 2;
}

export type IntegrationsRunPlan = { mode: "baseline" } | { mode: "read" };

/**
 * Decide the run. `heldRows` is how many integrations we already hold for this
 * competitor — zero means we have never read their catalog, whatever it shows today.
 *
 * A catalog lists every integration the company has ever shipped, so the first read
 * would announce forty "new partnerships" the day a competitor is added. The rows are
 * written — that memory is the point — and nothing signals.
 */
export function planIntegrationsRun(args: { heldRows: number }): IntegrationsRunPlan {
  return args.heldRows > 0 ? { mode: "read" } : { mode: "baseline" };
}
