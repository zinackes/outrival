import * as cheerio from "cheerio";
import { normalizeCustomerName } from "@outrival/shared";

/**
 * Who a competitor attacks by name (Positioning Intelligence v2 P2).
 *
 * The sitemap detector has known since sitemap v2 that a `/vs/` page appeared, and
 * it has only ever asked ONE question about it: does the slug name the READER. That
 * one case is a critical alert and stays exactly as it is. The other case — the far
 * more common one — was thrown away: `/vs/klue` says who this company thinks it is
 * losing deals to, and nothing recorded it.
 *
 * So this module reads the slug. It is the integrations reader's twin, deliberately,
 * down to the two readings and the conservatism:
 *
 *  - THE SITEMAP. Every competitor's sitemap is already walked weekly. A `/vs/klue`
 *    URL names Klue, and reading it costs nothing: no fetch, no parse, no model.
 *  - THE INDEX PAGE. A `/compare` hub that renders its cards client-side is invisible
 *    to the sitemap, so the index itself is probed — and only its LINKS are read,
 *    through these same URL patterns. Never its prose: a comparison page is full of
 *    capitalised product names in sentences, and a registry is permanent.
 *
 * A wrong name here is not a bad render. It enters the market map for good and it
 * raises "they opened a front against X", so silence is the correct output whenever
 * the URL is ambiguous.
 *
 * PURE: no I/O, no DB, no AI.
 */

/** Where a target was named. The first two are the only ones that can signal. */
export type NamedCompetitorSource = "vs_page" | "alternatives_page" | "blog" | "docs";

/** One rival a URL names. */
export interface ComparisonTargetHit {
  /** Prettified from the slug: "microsoft-teams" → "Microsoft Teams". */
  displayName: string;
  /** The registry key — the SAME normaliser the customer and integration
   *  registries use, so a name read off `/vs/klue` and off `/klue-alternative`
   *  is one target, not two. */
  nameNormalized: string;
  /**
   * Only when the slug IS a full domain (`/vs/crayon.co`). NEVER guessed: a
   * fabricated domain is what would let the cross-reference below claim two
   * unrelated companies are the same one.
   */
  namedDomain: string | null;
  source: "vs_page" | "alternatives_page";
  /** The exact page that names them, so a claim can be checked at its source. */
  evidenceUrl: string;
}

/**
 * Paths probed once, in order, to find a comparison hub. Short by design: three
 * GETs against someone else's site, not a crawl.
 */
export const COMPARISON_INDEX_PATHS: readonly string[] = ["/vs", "/compare", "/alternatives"];

/** Targets read off one index page. Past this it is a directory, not a hub. */
export const MAX_TARGETS_PER_INDEX = 200;

/** A hub has to link somewhere to be a hub. One link is a nav entry. */
const MIN_INDEX_TARGETS = 2;

/**
 * A comparison SECTION with a child slug: `/vs/klue`, `/compare/klue`. The slug is
 * the target. The bare section (`/compare`) is the hub itself and names nobody.
 */
const VS_SECTION_RE = /\/(?:vs|versus|compare|comparison|comparisons)\/([^/?#]+)\/?$/i;

/** `/alternatives/klue` — the same shape, filed under the other source. */
const ALTERNATIVES_SECTION_RE = /\/alternatives?\/([^/?#]+)\/?$/i;

/** `/klue-alternative`, `/klue-alternatives` — the suffix pattern, anywhere. */
const ALTERNATIVE_SUFFIX_RE = /\/([^/?#]+?)-alternatives?\/?$/i;

/**
 * A terminal `a-vs-b` segment, on ANY path: `/blog/klue-vs-crayon`, `/klue-vs-crayon`.
 * Both sides are targets — a page comparing two rivals is still this company
 * choosing whose fight to referee.
 */
const A_VS_B_RE = /\/([^/?#]*-(?:vs|versus)-[^/?#]*)\/?$/i;

/**
 * Slugs that are page CHROME, a category, or the site's own vocabulary — never a
 * rival. Each of these would otherwise enter the market map as a company called
 * "All" or "Best Tools".
 */
const GENERIC_SLUGS = new Set([
  "all",
  "alternative",
  "alternatives",
  "apps",
  "best",
  "categories",
  "category",
  "companies",
  "compare",
  "comparison",
  "comparisons",
  "competition",
  "competitors",
  "feature",
  "features",
  "home",
  "index",
  "integrations",
  "list",
  "more",
  "options",
  "other",
  "others",
  "overview",
  "page",
  "platform",
  "platforms",
  "pricing",
  "plans",
  "products",
  "search",
  "software",
  "solutions",
  "tools",
  "top",
  "us",
  "versus",
  "vs",
]);

/** Tokens that separate the two sides of an `a-vs-b` slug. */
const VS_TOKENS = new Set(["vs", "v", "versus"]);

/** Trailing words a comparison slug appends about ITSELF, not about the rival. */
const TRAILING_NOISE = new Set([
  "alternative",
  "alternatives",
  "comparison",
  "comparisons",
  "competitor",
  "competitors",
  "review",
  "reviews",
]);

/**
 * Extensions a slug can end in that make it a FILE. `.js` and `.php` are in here
 * for the same reason `.html` is: `/vs/node.js` would otherwise be read as the
 * domain node.js.
 */
const FILE_TLDS = new Set(["html", "htm", "php", "aspx", "asp", "json", "xml", "js", "css", "rss"]);

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,24})$/i;

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

/**
 * "microsoft-teams" → "Microsoft Teams".
 *
 * Words of two letters or less are upper-cased: a comparison slug is full of them
 * ("hr", "crm", "g2"), and "Hr Software" reads as a typo where "HR" reads as a
 * product. The trailing words that describe the PAGE rather than the rival
 * ("-comparison", "-review") are dropped, so `/vs/klue-comparison` and `/vs/klue`
 * are one target.
 */
export function prettifySlug(words: ReadonlyArray<string>): string {
  const trimmed = [...words];
  while (trimmed.length > 1 && TRAILING_NOISE.has(trimmed[trimmed.length - 1] as string)) {
    trimmed.pop();
  }
  return trimmed
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Turn one slug into a target, or null.
 *
 * Everything ambiguous returns null: chrome, a number, a file, a slug long enough
 * to be a sentence. What survives is short, alphabetic-ish, and reads as a name —
 * which is what a comparison slug is, because it exists to rank for one.
 */
function targetFromSlug(
  rawSlug: string,
  source: "vs_page" | "alternatives_page",
  evidenceUrl: string,
): ComparisonTargetHit | null {
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug).trim().toLowerCase();
  } catch {
    slug = rawSlug.trim().toLowerCase();
  }
  if (!slug || slug.length > 60) return null;
  if (GENERIC_SLUGS.has(slug)) return null;
  if (/^\d+$/.test(slug)) return null;

  // A slug that IS a domain is the strongest evidence a URL can carry, and the
  // only case where `namedDomain` is ever filled. The registrable label is the
  // name; the rest is the TLD.
  const domainMatch = DOMAIN_RE.exec(slug);
  const tld = domainMatch?.[1]?.toLowerCase();
  if (domainMatch && tld && FILE_TLDS.has(tld)) return null;
  const namedDomain = domainMatch ? slug : null;
  const nameSource = namedDomain ? (slug.split(".")[0] as string) : slug;

  const words = nameSource.split(/[-_]+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return null;
  // Anything still carrying a dot is a file or a path fragment, not a name.
  if (!namedDomain && nameSource.includes(".")) return null;

  const displayName = prettifySlug(words);
  const nameNormalized = normalizeCustomerName(displayName);
  // Under three characters a name cannot be told apart from an abbreviation, which
  // is the same floor the brand matcher uses.
  if (nameNormalized.length < 3) return null;
  if (GENERIC_SLUGS.has(nameNormalized)) return null;

  return { displayName, nameNormalized, namedDomain, source, evidenceUrl };
}

/**
 * Every rival ONE url names, deduped on the registry key.
 *
 * An `a-vs-b` slug yields two; every other pattern yields at most one. A URL that
 * matches nothing we recognise yields none, which is the common case and the point.
 */
export function comparisonTargetsFromUrl(url: string): ComparisonTargetHit[] {
  const path = pathOf(url);
  const out: ComparisonTargetHit[] = [];
  const seen = new Set<string>();
  const push = (hit: ComparisonTargetHit | null) => {
    if (!hit || seen.has(hit.nameNormalized)) return;
    seen.add(hit.nameNormalized);
    out.push(hit);
  };

  // `/alternatives/klue` and `/klue-alternative` first: both also contain a
  // segment the vs patterns would read, and "alternative" is the honest source.
  const altSection = ALTERNATIVES_SECTION_RE.exec(path)?.[1];
  const altSuffix = ALTERNATIVE_SUFFIX_RE.exec(path)?.[1];
  const source: "vs_page" | "alternatives_page" =
    altSection || altSuffix ? "alternatives_page" : "vs_page";

  // The `a-vs-b` split runs on whichever segment the patterns landed on, so
  // `/alternatives/klue-vs-crayon` names both under the alternatives source.
  const segment = altSection ?? altSuffix ?? VS_SECTION_RE.exec(path)?.[1] ?? A_VS_B_RE.exec(path)?.[1];
  if (!segment) return out;

  const sides = splitVsSides(segment);
  for (const side of sides) push(targetFromSlug(side, source, url));
  return out;
}

/**
 * "klue-vs-crayon" → ["klue", "crayon"]. A slug with no standalone `vs` token
 * comes back whole, so this is the only splitter the patterns above need.
 */
function splitVsSides(segment: string): string[] {
  const words = segment.split(/[-_]+/).filter(Boolean);
  if (!words.some((w) => VS_TOKENS.has(w.toLowerCase()))) return [segment];
  const sides: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    if (VS_TOKENS.has(word.toLowerCase())) {
      if (current.length > 0) sides.push(current.join("-"));
      current = [];
      continue;
    }
    current.push(word);
  }
  if (current.length > 0) sides.push(current.join("-"));
  return sides;
}

/**
 * Every rival a set of URLs names, deduped on the REGISTRY key — name AND source.
 *
 * Not on the name alone: `/vs/klue` and `/klue-alternatives` are two rows, because
 * the two are different evidence about the same rivalry and the map shows both. The
 * signal deduplicates on the name for life; that is a separate rule, and collapsing
 * them here would quietly throw away the second page.
 *
 * Within one key the first URL wins: it is the evidence we can prove.
 */
export function comparisonTargetsFromUrls(
  urls: ReadonlyArray<string>,
): ComparisonTargetHit[] {
  const out: ComparisonTargetHit[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    for (const hit of comparisonTargetsFromUrl(url)) {
      const key = `${hit.nameNormalized} ${hit.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(hit);
      if (out.length >= MAX_TARGETS_PER_INDEX) return out;
    }
  }
  return out;
}

/**
 * The rivals a comparison hub links to.
 *
 * LINKS ONLY, and only same-host links whose URL matches the patterns above. The
 * page's prose is never read: a `/compare` hub is a wall of sentences naming
 * products, and a registry entry lifted out of one of those sentences would be
 * permanent and wrong. If the hub does not link to its own comparison pages, we
 * learn nothing from it — which is the correct outcome, not a gap to paper over.
 */
export function parseComparisonIndex(html: string, baseUrl: string): ComparisonTargetHit[] {
  const $ = cheerio.load(html);
  const base = hostOf(baseUrl);
  const urls: string[] = [];

  $("a[href]").each((_, el) => {
    if (urls.length >= MAX_TARGETS_PER_INDEX * 2) return;
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

  return comparisonTargetsFromUrls(urls);
}

/**
 * Is this page really a comparison hub, or a site that answers 200 for every path?
 *
 * The link patterns already do most of the work — a homepage does not usually link
 * to two `/vs/` pages — so the only extra requirement is that it link to more than
 * one. One link is a nav entry, and caching a nav as "their comparison hub" would
 * re-read the wrong page every week.
 */
export function looksLikeComparisonIndex(html: string, url: string): boolean {
  return parseComparisonIndex(html, url).length >= MIN_INDEX_TARGETS;
}

export type ComparisonRunPlan = { mode: "baseline" } | { mode: "read" };

/**
 * Decide the run.
 *
 * `baselinedAt` is an explicit marker, NOT a row count, and that is the whole point:
 * a competitor who publishes no comparison pages at all keeps an empty registry
 * forever, so a count would make every run "the first run" — and the day they
 * finally publish their first `/vs/` page, the most newsworthy one they will ever
 * publish, it would be swallowed as a baseline. (The customers registry hit the
 * same shape in P3 and had a second table to count; this one has nothing to count.)
 */
export function planComparisonRun(args: { baselinedAt: Date | null }): ComparisonRunPlan {
  return args.baselinedAt ? { mode: "read" } : { mode: "baseline" };
}
