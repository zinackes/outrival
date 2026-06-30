import * as cheerio from "cheerio";
import {
  classifyLogoName,
  isBlankSvgDataUri,
  isStoreBadgeSrc,
  isLanguageFlagSrc,
} from "@outrival/shared";
import { hashTestimonial, type TestimonialItem, type CustomerLogo } from "./social-proof";
import { extractJsonLd, findByType, asText } from "../structured-data/json-ld";

/**
 * Turns rendered homepage HTML into a typed, diff-friendly semantic structure
 * (patch-16). The point is to diff *meaning* (hero headline, sections, nav,
 * social proof) instead of a flat blob of visible-text lines: a rotating
 * testimonial carousel or a re-ordered section then stops faking a change, while
 * a real H1 / positioning move stands out.
 *
 * PURE: cheerio + synchronous logic only — no network, no side effects — so the
 * worker can run it on the freshly scraped HTML and on the prior snapshot's HTML
 * pulled from R2, and so it's unit-testable on fixtures. Deterministic: same
 * HTML → same structure.
 *
 * Homepage-only. Other sources keep the visible-content lexical diff.
 */

export type SectionType =
  | "features"
  | "pricing"
  | "testimonials"
  | "logos"
  | "faq"
  | "cta"
  | "integrations"
  | "other";

export interface Cta {
  text: string;
  href: string | null;
}

export interface NavItem {
  text: string;
  href: string | null;
}

export interface HomepageSection {
  heading: string;
  level: 2 | 3;
  /** Aggregated visible text of the section (excludes nav/footer). */
  bodyText: string;
  type: SectionType;
  ctas: Cta[];
}

export interface HomepageStructure {
  // Global metadata
  title: string;
  /** Primary language subtag from <html lang> ("fr", "de", "en"), lowercased.
   *  Null when the page declares none. Lets the UI flag/translate foreign copy. */
  language: string | null;
  metaDescription: string | null;
  canonical: string | null;
  openGraph: {
    title: string | null;
    description: string | null;
    image: string | null;
    type: string | null;
  };

  // Hero (the H1 and its immediate context)
  hero: {
    headline: string | null;
    subheadline: string | null;
    primaryCta: Cta | null;
    secondaryCta: Cta | null;
  };

  // Page sections, one per H2/H3, in document order
  sections: HomepageSection[];

  navigation: { items: NavItem[] };
  footer: { links: NavItem[]; text: string };

  // Social-proof signals. customerLogos + testimonialCount are the patch-16
  // count-only fields (kept for the count diff); testimonials carries hashed
  // quotes for patch-17 stable add/remove tracking (worker-orchestrated).
  socialProof: {
    customerLogos: CustomerLogo[];
    testimonialCount: number;
    testimonials: TestimonialItem[];
  };
}

// Keep the stored JSON bounded — a homepage with thousands of nodes shouldn't
// bloat the snapshot row or the downstream prompt.
const MAX_SECTIONS = 60;
const MAX_SECTION_BODY = 4000;
const MAX_CTAS_PER_SECTION = 12;
const MAX_NAV_ITEMS = 60;
const MAX_FOOTER_LINKS = 120;
const MAX_LOGOS = 60;
const MAX_TESTIMONIALS = 40;
const MAX_FOOTER_TEXT = 2000;

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

function resolveHref(raw: string | undefined, baseUrl: string): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t || t === "#" || t.toLowerCase().startsWith("javascript:")) return null;
  try {
    return new URL(t, baseUrl).toString();
  } catch {
    return t;
  }
}

// True when `href` points at the site's own homepage root (same host, "/" path) —
// the canonical "logo links home" pattern, used to skip the own brand logo.
function isHomepageRoot(href: string, baseUrl: string): boolean {
  const resolved = resolveHref(href, baseUrl);
  if (!resolved) return false;
  try {
    const u = new URL(resolved);
    const b = new URL(baseUrl);
    return u.host === b.host && (u.pathname === "/" || u.pathname === "");
  } catch {
    return false;
  }
}

// --- DOM walk types (domhandler nodes, cheerio's parse output). Local minimal
//     shape avoids pulling domhandler's types in as a direct dep (mirrors
//     extract-content.ts). ---
interface DomNode {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: DomNode[];
}

// Tags that force a visual break in the browser: text on either side reads as
// two words. `<br>` and block-level elements get whitespace inserted around them
// so adjacent runs don't glue ("Gérer<br>une" → "Gérer une"). Inline elements
// are intentionally absent: a styled substring ("Out<span>rival</span>") must
// stay one word, so we never separate across an inline boundary.
const BREAKING_TAGS = new Set([
  "br", "p", "div", "section", "article", "header", "footer", "main", "aside",
  "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "table", "tr", "td",
  "th", "thead", "tbody", "blockquote", "figure", "figcaption", "pre", "hr",
  "dl", "dt", "dd", "nav", "form", "fieldset", "address",
]);

// Browser-like text extraction: concatenate text nodes verbatim (preserving the
// source's own whitespace), inserting a space only at break boundaries. Cheerio's
// native .text() omits these breaks → "Gérer<br>une" collapses to "Gérerune".
function nodeText(node: DomNode): string {
  const out: string[] = [];
  const collect = (n: DomNode): void => {
    if (n.type === "text") {
      if (n.data) out.push(n.data);
      return;
    }
    if (n.type !== "tag") return;
    const name = (n.name ?? "").toLowerCase();
    if (name === "img") {
      const alt = n.attribs?.alt?.trim();
      if (alt) out.push(` ${alt} `);
      return;
    }
    const breaks = BREAKING_TAGS.has(name);
    if (breaks) out.push(" ");
    for (const c of n.children ?? []) collect(c);
    if (breaks) out.push(" ");
  };
  collect(node);
  return norm(out.join(""));
}

// Text of a cheerio selection's first element via the break-aware walk above
// (cheerio's own .text() glues across <br>/blocks). Empty string when absent.
function elText(el: DomNode | undefined): string {
  return el ? nodeText(el) : "";
}

interface RawSection {
  heading: string;
  level: 2 | 3;
  parts: string[];
  imgs: number;
  blockquotes: number;
  details: number;
  ctas: Cta[];
}

const PRICE_RE = /[$€£]\s?\d/;
const PERIOD_RE = /\b(\/mo|\/yr|per month|per year|month|monthly|year|annually|seat|user)\b/i;

function classifySection(s: RawSection, body: string): SectionType {
  const h = s.heading.toLowerCase();
  const b = body.toLowerCase();

  // Heading keywords are the strongest, least ambiguous cue.
  if (/\b(pricing|plans?|tiers?)\b/.test(h)) return "pricing";
  if (/\b(faq|frequently asked|common questions|questions)\b/.test(h) || s.details >= 2)
    return "faq";
  if (/\b(integrat)/.test(h)) return "integrations";
  if (/(testimonial|reviews?|loved by|customers? say|what .* say|wall of love)/.test(h))
    return "testimonials";
  if (
    /\b(trusted by|used by|customers|partners|brands|companies)\b/.test(h) &&
    s.imgs >= 3 &&
    b.replace(/\s/g, "").length < 200
  )
    return "logos";

  // Structural / body cues when the heading is generic.
  if (s.blockquotes >= 1) return "testimonials";
  if (PRICE_RE.test(body) && PERIOD_RE.test(body)) return "pricing";
  if (s.imgs >= 5 && b.replace(/\s/g, "").length < 120) return "logos";
  if (/\b(get started|start free|book a demo|contact sales|sign up|try .* free)\b/.test(h) && s.ctas.length >= 1)
    return "cta";
  if (/\b(features?|why |how it works|capabilities|product)\b/.test(h)) return "features";

  return "other";
}

function walkSections(body: DomNode, baseUrl: string): RawSection[] {
  const sections: RawSection[] = [];
  let current: RawSection | null = null;

  const walk = (node: DomNode): void => {
    if (node.type === "text") {
      if (current && node.data) current.parts.push(node.data);
      return;
    }
    if (node.type !== "tag") return;
    const tag = (node.name ?? "").toLowerCase();

    if (tag === "h2" || tag === "h3") {
      const heading = nodeText(node);
      // Skip empty headings (decorative <h2></h2>) — they'd create blank sections.
      if (heading) {
        current = {
          heading,
          level: tag === "h2" ? 2 : 3,
          parts: [],
          imgs: 0,
          blockquotes: 0,
          details: 0,
          ctas: [],
        };
        sections.push(current);
      }
      return; // heading text is captured above, not re-collected into bodyText
    }

    // Everything before the first H2/H3 (the hero zone) has no current section
    // and is intentionally dropped here — the hero is extracted separately.
    if (current) {
      if (tag === "img") {
        current.imgs++;
        return;
      }
      if (tag === "blockquote") current.blockquotes++;
      if (tag === "details") current.details++;
      if ((tag === "a" || tag === "button") && current.ctas.length < MAX_CTAS_PER_SECTION) {
        const text = nodeText(node);
        if (text) {
          const href = tag === "a" ? resolveHref(node.attribs?.href, baseUrl) : null;
          current.ctas.push({ text, href });
        }
      }
    }

    for (const child of node.children ?? []) walk(child);
  };

  walk(body);
  return sections;
}

type CheerioRoot = ReturnType<typeof cheerio.load>;

function extractHero(
  $: CheerioRoot,
  baseUrl: string,
): HomepageStructure["hero"] {
  const h1 = $("h1").first();
  const headline = elText(h1[0] as unknown as DomNode | undefined) || null;

  // Subheadline: the first paragraph or H2 that follows the H1 in its vicinity.
  let subheadline: string | null = null;
  if (h1.length) {
    const next = h1.nextAll("p, h2").first();
    const candidate = next.length
      ? elText(next[0] as unknown as DomNode | undefined)
      : elText(h1.parent().find("p").first()[0] as unknown as DomNode | undefined);
    subheadline = candidate || null;
  }

  // CTAs: links/buttons within the hero scope (the H1's nearest section/header
  // ancestor, falling back to its parent). The first "primary-looking" one wins.
  const scope = h1.closest("section, header, div");
  const root = scope.length ? scope : h1.parent();
  // Pair each candidate with its class string so "primary-looking" can be judged
  // without leaning on a cheerio element type that isn't exported in v1.
  const candidates: Array<Cta & { cls: string }> = [];
  root.find("a, button").each((_, el) => {
    if (candidates.length >= 8) return;
    const $el = $(el);
    const text = norm($el.text());
    if (!text) return;
    const isAnchor = (el as unknown as DomNode).name?.toLowerCase() === "a";
    const href = isAnchor ? resolveHref($el.attr("href"), baseUrl) : null;
    candidates.push({ text, href, cls: ($el.attr("class") ?? "").toLowerCase() });
  });
  const looksPrimary = (c: { cls: string; text: string }): boolean =>
    /primary|btn-primary|cta|get-?started|sign-?up|start/.test(c.cls) ||
    /get started|start free|sign up|try /i.test(c.text);

  const strip = (c: Cta & { cls: string }): Cta => ({ text: c.text, href: c.href });
  const primaryRaw = candidates.find(looksPrimary) ?? candidates[0] ?? null;
  const primaryCta = primaryRaw ? strip(primaryRaw) : null;
  const secondaryRaw = candidates.find((c) => c.text !== primaryCta?.text) ?? null;
  const secondaryCta = secondaryRaw ? strip(secondaryRaw) : null;

  return { headline, subheadline, primaryCta, secondaryCta };
}

function extractNavigation($: CheerioRoot, baseUrl: string): HomepageStructure["navigation"] {
  const nav = $("header nav").first().length ? $("header nav").first() : $("nav").first();
  const items: NavItem[] = [];
  const seen = new Set<string>();
  nav.find("a").each((_, el) => {
    if (items.length >= MAX_NAV_ITEMS) return;
    const $el = $(el);
    const text = norm($el.text());
    if (!text || seen.has(text)) return;
    seen.add(text);
    items.push({ text, href: resolveHref($el.attr("href"), baseUrl) });
  });
  return { items };
}

function extractFooter($: CheerioRoot, baseUrl: string): HomepageStructure["footer"] {
  const footer = $("footer").first();
  const links: NavItem[] = [];
  const seen = new Set<string>();
  footer.find("a").each((_, el) => {
    if (links.length >= MAX_FOOTER_LINKS) return;
    const $el = $(el);
    const text = norm($el.text());
    if (!text || seen.has(text)) return;
    seen.add(text);
    links.push({ text, href: resolveHref($el.attr("href"), baseUrl) });
  });
  // Copyright year churns on a stable footer — normalise it out so it doesn't
  // fake a footer change.
  const text = norm(footer.text())
    .replace(/(©|copyright)\s*\d{4}(\s*[-–]\s*\d{4})?/gi, "$1 «year»")
    .slice(0, MAX_FOOTER_TEXT);
  return { links, text };
}

function extractSocialProof(
  $: CheerioRoot,
  baseUrl: string,
): HomepageStructure["socialProof"] {
  const logos: CustomerLogo[] = [];
  const seen = new Set<string>();
  $(
    '[class*="logo" i], [id*="logo" i], [class*="customer" i], [class*="trusted" i], [class*="brand" i], [class*="partner" i]',
  )
    .find("img")
    .each((_, el) => {
      if (logos.length >= MAX_LOGOS) return;
      const $el = $(el);
      // Site chrome (header/nav/footer) carries the competitor's OWN brand mark
      // and menu glyphs, not customer proof — customer "trusted by" strips live
      // in the page body. Likewise an img wrapped in a link back to the homepage
      // root is the own logo. Both otherwise flood the wall with the site itself.
      // Testimonial / review / rating cards hold author avatars and review-site
      // badges (Capterra/G2 stars), not customer brands — exclude their context.
      if (
        $el.closest(
          'header, nav, footer, blockquote, [class*="header" i], [class*="navbar" i], [class*="footer" i], [class*="testimonial" i], [class*="quote" i], [class*="review" i], [class*="rating" i], [class*="avatar" i]',
        ).length
      )
        return;
      const linkHref = $el.closest("a").attr("href");
      if (linkHref && isHomepageRoot(linkHref, baseUrl)) return;
      // Tracking pixels / spacer gifs declared with tiny dimensions render as
      // blank tiles — skip them.
      const w = parseInt($el.attr("width") || "", 10);
      const h = parseInt($el.attr("height") || "", 10);
      if ((w && w <= 16) || (h && h <= 16)) return;
      const name = norm($el.attr("alt") || "") || null;
      // Real asset, preferring a lazy attribute when the eager src is a
      // placeholder (logo carousels ship a 1x1 data: URI in src, the asset in
      // data-src / srcset), then resolved to an absolute URL so the UI can render it.
      const eager = ($el.attr("src") || "").trim();
      const lazy = (
        $el.attr("data-src") ||
        $el.attr("data-original") ||
        $el.attr("data-lazy-src") ||
        ""
      ).trim();
      const srcset = ($el.attr("srcset") || "").trim();
      const rawSrc =
        lazy && (!eager || /^data:/i.test(eager))
          ? lazy
          : eager || srcset.split(",")[0]?.trim().split(/\s+/)[0] || lazy;
      const src = resolveHref(rawSrc, baseUrl);
      // Brand-name classifier: drop confident non-brands (frames, colour codes,
      // review/compliance badges, person names, descriptive phrases), recover the
      // clean brand name, or null an uninformative placeholder and lean on the
      // image. Drop blank-SVG spacers and store-download badges on the src side.
      const verdict = classifyLogoName(name);
      if (verdict.kind === "junk") return;
      const brandName = verdict.kind === "brand" ? verdict.name : null;
      const cleanSrc =
        src && !isBlankSvgDataUri(src) && !isStoreBadgeSrc(src) && !isLanguageFlagSrc(src)
          ? src
          : null;
      if (!brandName && !cleanSrc) return;
      const key = (brandName ?? cleanSrc ?? "").toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      logos.push({ name: brandName, src: cleanSrc });
    });

  const testimonialCount =
    $("blockquote").length + $('[class*="testimonial" i], [class*="quote" i]').length;

  // Detailed testimonials (patch-17): a hashed quote + author per item, for the
  // stable add/remove diff. Bounded length filters out non-quote matches; the
  // hash lets a rotating carousel be matched across scrapes.
  const testimonials: TestimonialItem[] = [];
  const seenQuotes = new Set<string>();
  $('blockquote, [class*="testimonial" i], [class*="quote" i]').each((_, el) => {
    if (testimonials.length >= MAX_TESTIMONIALS) return;
    const $el = $(el);
    const quote =
      elText($el.find("p").first()[0] as unknown as DomNode | undefined) ||
      elText(el as unknown as DomNode);
    if (quote.length < 30 || quote.length > 1000) return;
    const author =
      elText(
        $el.find('cite, [class*="author" i], [class*="name" i]').first()[0] as unknown as
          | DomNode
          | undefined,
      ) || null;
    const hash = hashTestimonial(quote);
    if (seenQuotes.has(hash)) return;
    seenQuotes.add(hash);
    testimonials.push({ hash, quote: quote.slice(0, 280), author });
  });

  return { customerLogos: logos, testimonialCount, testimonials };
}

export function parseHomepageStructure(html: string, baseUrl: string): HomepageStructure {
  const $ = cheerio.load(html);

  // 1. Metadata first — read before we strip <head>.
  const title = norm($("title").first().text());
  // <html lang="fr-FR"> → "fr". The lang attribute lives on the root element, so
  // it survives the <head> strip below, but read it here with the rest of the meta.
  const langAttr = ($("html").attr("lang") || "").trim().split(/[-_]/)[0]?.toLowerCase();
  const language = langAttr ? langAttr : null;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
  const canonical = $('link[rel="canonical"]').attr("href")?.trim() || null;
  const openGraph = {
    title: $('meta[property="og:title"]').attr("content")?.trim() || null,
    description: $('meta[property="og:description"]').attr("content")?.trim() || null,
    image: $('meta[property="og:image"]').attr("content")?.trim() || null,
    type: $('meta[property="og:type"]').attr("content")?.trim() || null,
  };

  // Structured-first fallback (patch-30): some sites ship schema.org JSON-LD but no
  // OpenGraph tags. Seed the identity (name/description) from it so the meta diff
  // still tracks naming/positioning shifts — geo/language-agnostic. extractJsonLd
  // reloads the raw HTML, so it sees the <script> blocks stripped below.
  if (!openGraph.title || !openGraph.description) {
    const ld = extractJsonLd(html);
    const identity =
      findByType(ld, "Organization")[0] ??
      findByType(ld, "WebSite")[0] ??
      findByType(ld, "SoftwareApplication")[0] ??
      findByType(ld, "Product")[0];
    if (identity) {
      openGraph.title ??= asText(identity["name"]) ?? asText(identity["legalName"]);
      openGraph.description ??= asText(identity["description"]) ?? asText(identity["slogan"]);
    }
  }

  // 2. Strip non-content: scripts/styles/SVG/iframes, aria-hidden, cookie banners.
  $("script, style, noscript, svg, template, head, iframe, object, embed, canvas").remove();
  $("[aria-hidden='true'], [hidden]").remove();
  $(
    "#onetrust-consent-sdk, #onetrust-banner-sdk, #CybotCookiebotDialog, #osano-cm-window, [class*='cookie-banner' i], [id*='cookie-banner' i]",
  ).remove();

  // 3. Capture nav/footer/social proof on the cleaned DOM, then remove nav and
  //    footer so the section walk below doesn't attribute their links to a section.
  const hero = extractHero($, baseUrl);
  const navigation = extractNavigation($, baseUrl);
  const footer = extractFooter($, baseUrl);
  const socialProof = extractSocialProof($, baseUrl);
  $("nav, footer").remove();

  // 4. Section walk over the body, then heuristically type each section.
  const bodyEl = ($("body")[0] ?? $.root()[0]) as unknown as DomNode | undefined;
  const raw = bodyEl ? walkSections(bodyEl, baseUrl) : [];
  const sections: HomepageSection[] = raw.slice(0, MAX_SECTIONS).map((s) => {
    const bodyText = norm(s.parts.join(" ")).slice(0, MAX_SECTION_BODY);
    return {
      heading: s.heading,
      level: s.level,
      bodyText,
      type: classifySection(s, bodyText),
      ctas: s.ctas,
    };
  });

  return {
    title,
    language,
    metaDescription,
    canonical,
    openGraph,
    hero,
    sections,
    navigation,
    footer,
    socialProof,
  };
}
