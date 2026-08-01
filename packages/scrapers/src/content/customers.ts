import * as cheerio from "cheerio";
import { classifyLogoName, normalizeCustomerName, resolveIndustry } from "@outrival/shared";
import { isVerbatim } from "../jobs/jd-facts";

/**
 * Reading a competitor's customer proof (Content Intelligence v2 P3).
 *
 * A competitor's /customers page and its case studies are the loudest thing it
 * publishes about who it is beating and where. We already tracked the homepage logo
 * wall (patch-17), which says how many logos there are; this says WHO, IN WHAT
 * MARKET, and WITH WHAT NUMBER — the difference between a wall and a win.
 *
 * Everything here is PURE (no I/O, no DB, no AI) and holds the two rules that make
 * the feature safe to ship:
 *
 *  - THE FIRST PASS IS A BASELINE. A customers page lists every customer the
 *    company has ever had. Signalling on the first read would announce fifteen
 *    "wins" the day a competitor is added, all of them years old. The rows and the
 *    registry are written — that memory is the point — and nothing signals.
 *  - THE MODEL PROPOSES, CODE DECIDES. A customer name and every claimed metric
 *    must be findable in the page's own text (`isVerbatim`, the posting_facts
 *    rule). A "42% faster" nobody wrote is worse than no metric at all: the whole
 *    value of a claimed number is that the competitor is on record saying it.
 */

/**
 * Paths probed once, in order, to find a competitor's customers index. Ordered by
 * how likely each is to be a real index rather than a redirect, and kept short:
 * this is a handful of GETs against someone else's site, not a crawl.
 */
export const CUSTOMER_INDEX_PATHS: readonly string[] = [
  "/customers",
  "/case-studies",
  "/customer-stories",
  "/case-study",
  "/success-stories",
  "/clients",
  "/temoignages",
  "/references",
  "/kunden",
  "/referenzen",
  "/clientes",
  "/casos-de-exito",
];

/**
 * A URL that is a customers index or an individual customer story, in the five
 * languages our roster actually publishes in. Path-only, so a query string or a
 * tracking parameter can never turn an unrelated page into a case study.
 */
const CUSTOMER_PATH_RES: readonly RegExp[] = [
  /\/customers?(\/|$)/i,
  /\/case-stud(?:y|ies)(\/|$)/i,
  /\/customer-stor(?:y|ies)(\/|$)/i,
  /\/success-stor(?:y|ies)(\/|$)/i,
  /\/clients?(\/|$)/i,
  /\/temoignages?(\/|$)/i,
  /\/etudes?-de-cas(\/|$)/i,
  /\/kunden(?:stories|referenzen)?(\/|$)/i,
  /\/referenzen(\/|$)/i,
  /\/anwenderberichte(\/|$)/i,
  /\/fallstudien?(\/|$)/i,
  /\/clientes(\/|$)/i,
  /\/casos-de-exito(\/|$)/i,
  /\/historias-de-clientes(\/|$)/i,
];

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

/** Is this a customers page — an index, or one customer's story? Pure, path-only. */
export function isCustomerPageUrl(url: string): boolean {
  const path = pathOf(url);
  return CUSTOMER_PATH_RES.some((re) => re.test(path));
}

/**
 * Is this the INDEX rather than one story? True when the path ends at the section
 * root ("/customers", "/en/case-studies/"), false once a slug follows it
 * ("/customers/acme"). The distinction decides what we read the page FOR: an index
 * is a logo wall plus links, a story is one customer.
 */
export function isCustomerIndexUrl(url: string): boolean {
  const path = pathOf(url).replace(/\/+$/, "");
  if (!isCustomerPageUrl(url)) return false;
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return false;
  return CUSTOMER_PATH_RES.some((re) => re.test(`/${last}`));
}

/** Names lifted off a customers page, in the page's own casing. */
export interface CustomerNameHit {
  /** Exactly as the page wrote it. */
  displayName: string;
  /** The registry key (lowercased, legal form stripped). */
  nameNormalized: string;
}

// Site chrome and social proof that is NOT a customer: the header/footer own-brand
// mark, testimonial avatars, review-site badges. Same list the homepage wall uses,
// so the two readings of a logo can never disagree about what counts.
const LOGO_CHROME_SEL =
  'header, nav, footer, [class*="header" i], [class*="navbar" i], [class*="footer" i], [class*="testimonial" i], [class*="quote" i], [class*="review" i], [class*="rating" i], [class*="avatar" i]';

// An alt that is a URL or a file name is a logo with no alt text at all — the CDN
// path leaked into the attribute. The homepage wall drops these for the same
// reason: a path is not a brand, and an unnamed logo is not a customer win.
function looksLikeAsset(s: string): boolean {
  return /^https?:\/\//i.test(s) || /\.(png|jpe?g|svg|webp|gif)(\?|$)/i.test(s) || s.includes("/");
}

/** Logos read per page. A wall past this is a marquee duplicating itself. */
export const MAX_LOGOS_PER_PAGE = 80;
/** Case-study links followed per index page, per run. */
export const MAX_CASE_STUDY_LINKS = 10;

/**
 * The customer brands a page names, read from `<img alt>` ONLY.
 *
 * Alt text is the one place a logo states its own brand in words, and it is the
 * same signal `classifyLogoName` was built for — so design-tool exports ("Frame
 * 616"), award badges ("Rated 4.5/5") and testimonial author names never enter the
 * registry. No image recognition, no guessing from file names: a logo whose alt is
 * a CDN path is a logo we cannot name, and an unnamed logo is not a customer win.
 */
export function parseCustomerLogos(html: string): CustomerNameHit[] {
  const $ = cheerio.load(html);
  const hits: CustomerNameHit[] = [];
  const seen = new Set<string>();

  $("img[alt]").each((_, el) => {
    if (hits.length >= MAX_LOGOS_PER_PAGE) return;
    const $el = $(el);
    if ($el.closest(LOGO_CHROME_SEL).length) return;
    const alt = ($el.attr("alt") ?? "").replace(/\s+/g, " ").trim();
    if (!alt || alt.length > 60 || looksLikeAsset(alt)) return;
    const verdict = classifyLogoName(alt);
    if (verdict.kind !== "brand") return;
    const nameNormalized = normalizeCustomerName(verdict.name);
    if (!nameNormalized || seen.has(nameNormalized)) return;
    seen.add(nameNormalized);
    hits.push({ displayName: verdict.name, nameNormalized });
  });

  return hits;
}

/**
 * Links from a customers index to the individual stories it lists.
 *
 * Same host only, and only paths that read as a customer story. A story on another
 * domain is somebody else's page, and following a link because it merely appears on
 * this page is how a crawl starts.
 */
export function findCaseStudyLinks(
  html: string,
  baseUrl: string,
  cap: number = MAX_CASE_STUDY_LINKS,
): string[] {
  const $ = cheerio.load(html);
  const base = hostOf(baseUrl);
  const basePath = pathOf(baseUrl).replace(/\/+$/, "");
  const out: string[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    if (out.length >= cap) return;
    const raw = ($(el).attr("href") ?? "").trim();
    if (!raw || raw.startsWith("#") || raw.toLowerCase().startsWith("javascript:")) return;
    let resolved: string;
    try {
      const u = new URL(raw, baseUrl);
      u.hash = "";
      resolved = u.toString();
    } catch {
      return;
    }
    if (hostOf(resolved) !== base) return;
    if (!isCustomerPageUrl(resolved)) return;
    // The index itself, and any other index, are not stories.
    if (isCustomerIndexUrl(resolved)) return;
    if (pathOf(resolved).replace(/\/+$/, "") === basePath) return;
    if (seen.has(resolved)) return;
    seen.add(resolved);
    out.push(resolved);
  });

  return out;
}

// What a customers index calls itself, in its <title> or its first headings. The
// vocabulary is the same one the URL patterns use, because a page that IS the
// customers page says so in both places.
const CUSTOMERS_HEADING_RE =
  /\b(customers?|clients?|case stud(?:y|ies)|success stor(?:y|ies)|customer stor(?:y|ies)|testimonials?|temoignages?|references?|referenzen|kunden|kundenreferenzen|fallstudien|clientes|casos de exito)\b/i;

/**
 * Is this page really the customers index, or a redirect that answered 200?
 *
 * A probe walks a list of guessed paths, and a site that serves its homepage for
 * every unknown path would otherwise hand us a homepage full of customer logos —
 * which is exactly what this is looking for, so counting logos alone cannot tell
 * the two apart. A page that IS the customers index NAMES itself in its title or a
 * heading; a homepage does not. Both signals are required: the name, and something
 * to read (logos, or links to stories).
 */
export function looksLikeCustomersIndex(html: string, url: string): boolean {
  const $ = cheerio.load(html);
  const title = ($("title").first().text() || "").replace(/\s+/g, " ").trim();
  const headings = $("h1, h2")
    .slice(0, 5)
    .map((_, el) => $(el).text())
    .get()
    .join(" ");
  const namesItself =
    CUSTOMERS_HEADING_RE.test(title) ||
    CUSTOMERS_HEADING_RE.test(headings) ||
    // "Trusted by …" is the other way a wall announces itself, and plenty of
    // customers pages lead with it instead of the word "customers".
    /\b(trusted by|used by|loved by|vertraut von|ils nous font confiance)\b/i.test(headings);
  if (!namesItself) return false;
  return parseCustomerLogos(html).length >= 2 || findCaseStudyLinks(html, url).length >= 1;
}

export type CustomersRunPlan = { mode: "baseline" } | { mode: "read" };

/**
 * Decide the run. `heldRows` is how much customer proof we already store for this
 * competitor — zero means we have never read their customers page, whatever it
 * shows today.
 */
export function planCustomersRun(args: { heldRows: number }): CustomersRunPlan {
  return args.heldRows > 0 ? { mode: "read" } : { mode: "baseline" };
}

/** Metrics kept per story. Past this the model is listing the page, not reading it. */
const MAX_METRICS = 5;
/** A claimed metric is a phrase ("cut onboarding time by 60%"), not a paragraph. */
const MAX_METRIC_CHARS = 120;
const MAX_USE_CASE_CHARS = 200;
const MAX_NAME_CHARS = 60;

export interface RawCaseStudy {
  customerName?: string | null;
  customerIndustryLabel?: string | null;
  useCase?: string | null;
  metricsClaimed?: unknown;
}

export interface GuardedCaseStudy {
  /** Null when the story is anonymised, or when the name is not in the page. */
  customerName: string | null;
  /** Canonical catalog slug, or the slugified label. Null when no market stated. */
  industrySlug: string | null;
  /** Whether `industrySlug` is a catalog slug — the only case that can raise
   *  severity, since a free-text slug matches nothing but its own page. */
  isCanonicalIndustry: boolean;
  /** The page's own words for the market, kept for display. */
  industryLabel: string | null;
  useCase: string | null;
  /** Verbatim, each one found in the page text. */
  metricsClaimed: string[];
}

/**
 * Apply every deterministic guard to one story's proposed extraction.
 *
 * `pageText` is what we fetched — the only thing a claim about this page may be
 * checked against. Two fields are checked and the rest are merely bounded, because
 * those two are what leave the product: the customer NAME becomes a permanent
 * registry row and a "new customer" alert, and a METRIC gets quoted back to the
 * reader as something the competitor said in public.
 */
export function applyCaseStudyGuards(pageText: string, raw: RawCaseStudy): GuardedCaseStudy {
  const nameRaw = (raw.customerName ?? "").replace(/\s+/g, " ").trim();
  // A model that reads "a leading European bank" and returns "European Bank" is
  // inventing a customer. The page has to write the name.
  const customerName =
    nameRaw && nameRaw.length <= MAX_NAME_CHARS && containsName(pageText, nameRaw)
      ? nameRaw
      : null;

  const industryRaw = (raw.customerIndustryLabel ?? "").replace(/\s+/g, " ").trim();
  const resolved = industryRaw ? resolveIndustry(industryRaw) : null;

  const metrics: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.metricsClaimed)) {
    for (const entry of raw.metricsClaimed) {
      if (typeof entry !== "string") continue;
      const metric = entry.replace(/\s+/g, " ").trim();
      if (!metric || metric.length > MAX_METRIC_CHARS) continue;
      // Same rule as posting_facts: a claim with no quotable source does not exist.
      if (!isVerbatim(metric, pageText)) continue;
      const key = metric.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      metrics.push(metric);
      if (metrics.length >= MAX_METRICS) break;
    }
  }

  const useCase = (raw.useCase ?? "").replace(/\s+/g, " ").trim();

  return {
    customerName,
    industrySlug: resolved ? resolved.slug : null,
    isCanonicalIndustry: resolved?.isCanonical ?? false,
    industryLabel: industryRaw ? industryRaw.slice(0, MAX_NAME_CHARS) : null,
    useCase: useCase ? useCase.slice(0, MAX_USE_CASE_CHARS) : null,
    metricsClaimed: metrics,
  };
}

/**
 * Does the page write this customer's name?
 *
 * `isVerbatim` requires twelve characters, which is right for a quoted sentence and
 * wrong for a company called "Acme" — so a name is checked as a name: matched at
 * word boundaries, so "Ramp" is not "Rampart".
 *
 * The match is CASE-SENSITIVE, and that is the whole guard. An anonymised story
 * writes "a leading European bank", and a model asked for the customer's name
 * routinely answers "European Bank" — which a case-insensitive search finds, because
 * the words really are on the page. A customer name is a proper noun and appears
 * capitalised; the description it was lifted from does not. The cost is a name the
 * page only ever sets in a lowercase or all-caps style, which is dropped — the safe
 * direction, and one the logo wall usually catches anyway.
 */
function containsName(pageText: string, name: string): boolean {
  const needle = name.replace(/\s+/g, " ").trim();
  if (needle.length < 2) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`).test(
    pageText.replace(/\s+/g, " "),
  );
}
