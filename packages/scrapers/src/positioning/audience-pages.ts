import * as cheerio from "cheerio";
import { resolveIndustry } from "@outrival/shared";
import { prettifySlug } from "./comparison-targets";

/**
 * Who a competitor says it sells to (Positioning Intelligence v2 P3).
 *
 * A company publishes its ICP as URLs: `/for/agencies` names a persona,
 * `/industries/fintech` names a vertical, `/use-cases/onboarding` names a job. Those
 * pages cost real money to write and are never published by accident — a new one is
 * a segment somebody decided to go after this quarter. Until now they landed in the
 * sitemap's generic "new pages appeared" lump, where "12 URLs were added" says
 * nothing about which market just opened.
 *
 * This is the market map's twin, deliberately, down to the two readings:
 *
 *  - THE SITEMAP. Already walked weekly. A `/industries/fintech` URL names a
 *    vertical, and reading it costs nothing: no fetch, no parse, no model.
 *  - THE INDEX PAGE. A `/solutions` hub that renders its cards client-side is
 *    invisible to the sitemap, so the index itself is probed — and only its LINKS
 *    are read, through these same URL patterns. Never its prose: a solutions hub is
 *    a wall of capitalised nouns in sentences, and a registry entry is permanent.
 *
 * PURE: no I/O, no DB, no AI.
 */

/** The three kinds an audience page can be. Closed — there is no fourth. */
export type AudienceKind = "persona" | "industry" | "use_case";

/** One audience page a URL names. */
export interface AudiencePageHit {
  kind: AudienceKind;
  /**
   * The identity. For persona / use_case it is the page's own URL slug; for
   * industry it is the catalog slug (or the slugified label), so a vertical read off
   * a sitemap and a vertical read off a case study are the SAME string.
   */
  slug: string;
  /** Prettified from the URL slug: "field-service" → "Field Service". */
  displayName: string;
  /** True only for an industry the catalog resolved — the comparable case. */
  isCanonical: boolean;
  /** The exact page, so a claim about their ICP can be checked at its source. */
  evidenceUrl: string;
}

/**
 * Paths probed once, in order, to find an audience hub. Short by design: four GETs
 * against someone else's site, not a crawl. Ordered by how often a hub actually
 * exists at each — `/solutions` is the most common landing for the whole family.
 */
export const AUDIENCE_INDEX_PATHS: readonly string[] = [
  "/solutions",
  "/use-cases",
  "/industries",
  "/for",
];

/** Pages read off one index. Past this it is a directory, not a hub. */
export const MAX_PAGES_PER_INDEX = 200;

/** A hub has to link somewhere to be a hub. One link is a nav entry. */
const MIN_INDEX_PAGES = 2;

/**
 * THE MAPPING. A URL section, in EN / FR / DE, to the kind of audience page it
 * introduces. Deterministic and closed: a section absent from this table produces
 * nothing at all. Guessing a fourth kind from an unknown section is how a registry
 * that is supposed to describe someone's ICP fills up with their nav.
 *
 * `/solutions` is filed as USE_CASE, and that is a judgement call worth stating:
 * "solutions" pages are named after a job to be done far more often than after a
 * buyer ("/solutions/incident-response", "/solutions/expense-management"). The
 * minority that name a persona land under use_case rather than under a guess, which
 * is the failure we want — a page in the wrong one of three known buckets, never a
 * page in a bucket nobody defined.
 */
const SECTION_KINDS: ReadonlyArray<readonly [RegExp, AudienceKind]> = [
  // Persona — who they are.
  [/\/(?:for|pour)\/([^/?#]+)/i, "persona"],
  // Industry — what market they are in.
  [/\/(?:industries|industry|secteurs|secteur|branchen|branche)\/([^/?#]+)/i, "industry"],
  // Use case — what they are trying to do.
  [/\/(?:use-cases?|usecases?|cas-d-usage|cas-dusage|anwendungsfalle|anwendungsfaelle)\/([^/?#]+)/i, "use_case"],
  [/\/(?:solutions?|losungen|loesungen)\/([^/?#]+)/i, "use_case"],
];

/**
 * Slugs that are page CHROME, a category root, or the site's own vocabulary — never
 * a segment. Each of these would otherwise enter the registry as a persona called
 * "Overview" or an industry called "All".
 */
const GENERIC_SLUGS = new Set([
  "a-propos",
  "about",
  "all",
  "blog",
  "categories",
  "category",
  "contact",
  "demo",
  "docs",
  "en",
  "faq",
  "feature",
  "features",
  "fr",
  "de",
  "home",
  "index",
  "learn",
  "list",
  "login",
  "more",
  "overview",
  "page",
  "partners",
  "plans",
  "platform",
  "preise",
  "pricing",
  "product",
  "products",
  "resources",
  "search",
  "signup",
  "solutions",
  "support",
  "tarifs",
  "use-cases",
  "usecases",
  "industries",
  "personas",
]);

/** Extensions that make a slug a FILE rather than a segment. */
const FILE_EXT_RE = /\.(?:html?|php|aspx?|json|xml|rss|css|js)$/i;

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** The host of a URL, lowercase and www-stripped, or null. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Does this URL introduce an audience page at all? The routing test scrape-monitor
 *  uses to keep these URLs out of the generic sitemap lump. */
export function isAudienceUrl(url: string): boolean {
  return audiencePageFromUrl(url) !== null;
}

/**
 * Turn one URL into an audience page, or null.
 *
 * ONE LEVEL OF DEPTH, always: `/solutions/finance/banking` is the FINANCE page's
 * child, and reading "banking" off it would file a sub-page as a second segment they
 * just opened. The first child segment is the segment; everything under it is that
 * segment's own site.
 *
 * Everything ambiguous returns null: a bare section (`/industries` is the hub, it
 * names nobody), chrome, a number, a file, a slug long enough to be a sentence.
 */
export function audiencePageFromUrl(url: string): AudiencePageHit | null {
  const path = pathOf(url);
  for (const [re, kind] of SECTION_KINDS) {
    // The regex is deliberately not anchored at the end: it matches the FIRST child
    // segment wherever the section sits ("/en/industries/fintech/case-studies"), and
    // the capture stops at the next slash — which is the one-level rule, expressed
    // where it cannot be forgotten.
    const rawSlug = re.exec(path)?.[1];
    if (!rawSlug) continue;
    const hit = hitFromSlug(rawSlug, kind, url);
    if (hit) return hit;
  }
  return null;
}

function hitFromSlug(rawSlug: string, kind: AudienceKind, evidenceUrl: string): AudiencePageHit | null {
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug).trim().toLowerCase();
  } catch {
    slug = rawSlug.trim().toLowerCase();
  }
  if (!slug || slug.length > 60) return null;
  if (FILE_EXT_RE.test(slug)) return null;
  if (/^\d+$/.test(slug)) return null;
  if (slug.includes(".")) return null;

  // Normalised to the URL-slug shape: a lone identity for a page whose only identity
  // IS its URL. Underscores and spaces collapse to hyphens so `/for/field_service`
  // and `/for/field-service` are one page, not two.
  const normalized = slug.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) return null;
  if (GENERIC_SLUGS.has(normalized)) return null;

  const words = normalized.split("-").filter(Boolean);
  // Past five words it is a sentence — an article title under /solutions/, not a
  // segment. Under three characters it cannot be told apart from an abbreviation.
  if (words.length === 0 || words.length > 5) return null;
  if (normalized.length < 3) return null;

  const displayName = prettifySlug(words);

  // An industry is the ONE kind with a shared vocabulary to answer to: the same
  // resolver `case_studies.customer_industry` went through. Without it,
  // `/industries/fin-tech` and a case study about "Fintech" are two unrelated
  // strings, and "declared vs proven" compares nothing.
  if (kind === "industry") {
    const resolved = resolveIndustry(displayName);
    return { kind, slug: resolved.slug, displayName, isCanonical: resolved.isCanonical, evidenceUrl };
  }
  return { kind, slug: normalized, displayName, isCanonical: false, evidenceUrl };
}

/**
 * Every audience page a set of URLs names, deduped on the registry key (kind + slug).
 *
 * Within one key the first URL wins: it is the evidence we can prove.
 */
export function audiencePagesFromUrls(urls: ReadonlyArray<string>): AudiencePageHit[] {
  const out: AudiencePageHit[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const hit = audiencePageFromUrl(url);
    if (!hit) continue;
    const key = `${hit.kind} ${hit.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
    if (out.length >= MAX_PAGES_PER_INDEX) return out;
  }
  return out;
}

/**
 * The segments an audience hub links to.
 *
 * LINKS ONLY, and only same-host links whose URL matches the patterns above. The
 * page's prose is never read: a `/solutions` hub is a wall of sentences naming
 * industries and job titles, and a registry entry lifted out of one of those
 * sentences would be permanent and wrong. If the hub does not link to its own
 * segment pages we learn nothing from it, which is the correct outcome.
 */
export function parseAudienceIndex(html: string, baseUrl: string): AudiencePageHit[] {
  const $ = cheerio.load(html);
  const base = hostOf(baseUrl);
  const urls: string[] = [];

  $("a[href]").each((_, el) => {
    if (urls.length >= MAX_PAGES_PER_INDEX * 2) return;
    const raw = ($(el).attr("href") ?? "").trim();
    if (!raw || raw.startsWith("#") || raw.toLowerCase().startsWith("javascript:")) return;
    try {
      const u = new URL(raw, baseUrl);
      u.hash = "";
      u.search = "";
      if (hostOf(u.toString()) !== base) return;
      urls.push(u.toString());
    } catch {
      // not a URL we can resolve — the page keeps its link, we keep our silence
    }
  });

  return audiencePagesFromUrls(urls);
}

/**
 * Is this page really an audience hub, or a site that answers 200 for every path?
 *
 * The link patterns do most of the work — a homepage does not usually link to two
 * `/industries/` pages — so the only extra requirement is that it link to more than
 * one. One link is a nav entry, and caching a nav as "their solutions hub" would
 * re-read the wrong page every week.
 */
export function looksLikeAudienceIndex(html: string, url: string): boolean {
  return parseAudienceIndex(html, url).length >= MIN_INDEX_PAGES;
}

export type AudienceRunPlan = { mode: "baseline" } | { mode: "read" };

/**
 * Decide the run.
 *
 * `baselinedAt` is an explicit marker, NOT a row count, for the reason the market
 * map's is: a competitor who publishes no audience pages at all keeps an empty
 * registry forever, so a count would make every run "the first run" — and the day
 * they finally publish their first `/industries/` page, the one that says they just
 * entered a vertical, it would be swallowed as back catalogue.
 */
export function planAudienceRun(args: { baselinedAt: Date | null }): AudienceRunPlan {
  return args.baselinedAt ? { mode: "read" } : { mode: "baseline" };
}

/** "persona" → "persona", "use_case" → "use-case". What a headline says out loud. */
export function audienceKindLabel(kind: AudienceKind): string {
  return kind === "use_case" ? "use-case" : kind;
}
