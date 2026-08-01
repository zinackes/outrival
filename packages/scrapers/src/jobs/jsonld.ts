/**
 * schema.org `JobPosting` → `AtsJob`, the coverage rung between a known ATS API
 * and the AI floor (Hiring Intelligence v2 P4).
 *
 * Nine providers have a hand-written API adapter. Everything else — Teamtailor,
 * JOIN, Softgarden, Taleez, Jobylon, and the long tail of self-built career sites
 * — fell straight through to the LLM, which reads a listing and can only ever
 * return what a listing prints: a title, maybe a location. The bodies, the dates,
 * the salaries and the countries were never on that page to begin with.
 *
 * They are, however, in the markup. Google indexes job postings from
 * `JobPosting` JSON-LD, so an ATS that wants its customers' roles in Google
 * Jobs emits it — which is nearly all of them. Reading it costs no AI at all and
 * carries `description`, `datePosted`, `baseSalary` and `addressCountry`, so P1
 * (JD mining), P2 (geo) and P3 (salary bands) light up on these boards for free.
 *
 * WHAT THIS MODULE DOES NOT DO: decide. It parses. A field the markup does not
 * carry comes back null and stays null — a partial posting read from the page is
 * worth more than a complete one inferred off it.
 *
 * PURE: cheerio + regex, no network, no AI. The fetching half (which pages to
 * open, how many, how politely) lives in `jobs.scraper.ts`, which owns the
 * cascade.
 */

import * as cheerio from "cheerio";
import { extractJsonLd, hasType, asText, asPrice, type JsonLdNode } from "../structured-data/json-ld";
import { htmlToPlainJd } from "./jd-facts";
import {
  mkJob,
  normalizeSalaryPeriod,
  normalizeSeniority,
  type AtsJob,
  type NormalizedSalary,
} from "./ats";

/**
 * Job-detail pages opened per run for postings we have never seen. The rest are
 * left for the next run rather than dropped: the listing crawl is what decides
 * which roles are OPEN, and it is complete either way — this cap only bounds how
 * fast the bodies behind the new ones get filled in.
 */
export const MAX_NEW_JOB_PAGES = 30;

/**
 * Listing pages walked per run. Unlike the detail cap above this one is NOT
 * allowed to silently truncate: a board still paginating when it runs out is
 * handed back as nothing, because a partial listing reads downstream as a
 * complete one with roles missing.
 */
export const MAX_LISTING_PAGES = 5;

/** At most this many places are folded into one posting's location string. */
const MAX_LOCATIONS = 3;

// ── Identity ─────────────────────────────────────────────────────────────────

/**
 * The canonical identity of a job page: scheme + host + path, with the query,
 * the fragment and any trailing slash removed.
 *
 * A board decorates its own links with campaign and session parameters
 * (`?utm_source=`, `?rk=`), so the same posting reaches us under several URLs
 * within a single run — and under different ones between runs. Keying on the raw
 * href would make every posting new every week.
 */
export function canonicalJobUrl(raw: string, base?: string): string | null {
  // An empty href is not a relative link: `new URL("", base)` RESOLVES TO THE BASE,
  // which would hand every posting that states no url the address of the page it
  // was read from — one identity shared by a whole board, and a board of one after
  // deduplication. Absence has to stay absence.
  if (!raw.trim()) return null;
  try {
    const u = base ? new URL(raw, base) : new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

// ── JSON-LD → AtsJob ─────────────────────────────────────────────────────────

/**
 * Expand `ItemList` containers so a listing that wraps its postings in one
 * survives. `extractJsonLd` already flattens arrays and `@graph`; it does not
 * walk `itemListElement`, whose entries are either the posting itself or a
 * `ListItem` wrapping it under `item`.
 */
function expandItemLists(nodes: JsonLdNode[]): JsonLdNode[] {
  const out: JsonLdNode[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 4) return;
    if (Array.isArray(value)) {
      for (const v of value) visit(v, depth);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as JsonLdNode;
    out.push(node);
    visit(node["itemListElement"], depth + 1);
    visit(node["item"], depth + 1);
  };
  for (const node of nodes) visit(node, 0);
  return out;
}

/**
 * Decode HTML entities when a value carries markup that was escaped INTO it.
 *
 * Teamtailor (and it is not alone) JSON-encodes an already-escaped body, so
 * `description` arrives as `&lt;p&gt;We are…&lt;/p&gt;`. `htmlToPlainJd` strips
 * tags first and decodes entities second — the correct order for real HTML — so
 * on this input the tags would materialise AFTER the stripping pass and survive
 * into the stored JD. One decode ahead of it puts the value back into the shape
 * the stripper expects. Only triggered when an escaped TAG is actually present,
 * so a body that merely mentions `&amp;` is untouched.
 */
function unescapeMarkup(value: string): string {
  if (!/&lt;\/?[a-z]/i.test(value)) return value;
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&");
}

/** A schema.org value that may be a bare string or a named node (`CategoryCode`). */
function nodeText(value: unknown): string | null {
  const direct = asText(value);
  if (direct) return direct;
  const obj = (Array.isArray(value) ? value[0] : value) as JsonLdNode | undefined;
  if (!obj || typeof obj !== "object") return null;
  return asText(obj["name"]) ?? asText(obj["codeValue"]) ?? null;
}

/** ISO date string from `datePosted` / `validThrough`, or null. */
function isoDate(value: unknown): string | null {
  const raw = asText(value);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The country an address states, PREFERRED as the ISO-3166-1 alpha-2 code the
 * markup carries. `addressCountry` is either that code or a country name (or a
 * `Country` node wrapping one), and the code is the half that cannot be
 * misread — putting it in the location string is what lets the offline resolver
 * (P2) pin the posting exactly instead of disambiguating a city name.
 */
function addressCountry(addr: JsonLdNode): string | null {
  return nodeText(addr["addressCountry"]);
}

/** One `jobLocation` entry → "Locality, Region, CC" (whatever it actually states). */
function placeText(place: unknown): string | null {
  const obj = (Array.isArray(place) ? place[0] : place) as JsonLdNode | undefined;
  if (!obj || typeof obj !== "object") return null;
  const address = obj["address"];
  const addr = (Array.isArray(address) ? address[0] : address) as JsonLdNode | undefined;
  if (!addr || typeof addr !== "object") {
    // Some boards ship the address as a bare string, or only a place name.
    return asText(address) ?? asText(obj["name"]) ?? null;
  }
  const parts = [
    asText(addr["addressLocality"]),
    asText(addr["addressRegion"]),
    addressCountry(addr),
  ].filter((p): p is string => Boolean(p));
  // Boards routinely repeat the city as the region — Teamtailor writes
  // "Berlin, Berlin, DE" on every German posting. Harmless to the resolver, but it
  // is the string a user reads on the Hiring tab, so the repetition goes.
  const seen = new Set<string>();
  const unique = parts.filter((p) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length > 0 ? unique.join(", ") : null;
}

/**
 * The posting's location line.
 *
 * Several `jobLocation` entries mean the SAME role is open in several places, so
 * they are joined with " / " — the separator the offline resolver reads as "or",
 * which makes the posting count for every country it names rather than the first.
 * Verified against the resolver: "Berlin, DE / Stockholm, SE" comes back as both.
 *
 * A telecommute posting keeps its anchor in parentheses ("Remote (DE)") rather
 * than collapsing to a bare "Remote", but only for the READER: the resolver
 * classifies the string as `remote` and returns no country, so hiring_geo counts
 * it under the reserved "remote" key. That is P2's decision, not an accident —
 * a remote role is not a country footprint — and this rung does not overrule it.
 */
function locationOf(node: JsonLdNode): string | null {
  const raw = node["jobLocation"];
  const places = (Array.isArray(raw) ? raw : [raw])
    .map(placeText)
    .filter((p): p is string => Boolean(p))
    .slice(0, MAX_LOCATIONS);
  const remote = /telecommute/i.test(asText(node["jobLocationType"]) ?? "");
  if (places.length === 0) return remote ? "Remote" : null;
  const line = places.join(" / ");
  return remote ? `Remote (${line})` : line;
}

/**
 * `baseSalary` → amounts + period. schema.org nests the numbers under
 * `value` (a `QuantitativeValue`) and states the interval in `unitText`
 * ("YEAR", "MONTH", "HOUR"), which `normalizeSalaryPeriod` already reads — the
 * same function every ATS adapter uses, so a period never means two things.
 * A single `value` with no min/max is a point salary, kept as the minimum.
 */
function baseSalary(raw: unknown): { salary: NormalizedSalary; period: ReturnType<typeof normalizeSalaryPeriod> } {
  const empty = { salary: { min: null, max: null, currency: null }, period: null };
  const node = (Array.isArray(raw) ? raw[0] : raw) as JsonLdNode | undefined;
  if (!node || typeof node !== "object") return empty;
  const valueRaw = node["value"];
  const value = (Array.isArray(valueRaw) ? valueRaw[0] : valueRaw) as JsonLdNode | undefined;
  const holder = value && typeof value === "object" ? value : node;
  const min = asPrice(holder["minValue"]) ?? asPrice(holder["value"]) ?? asPrice(valueRaw);
  const max = asPrice(holder["maxValue"]);
  if (min == null && max == null) return empty;
  const currency = asText(node["currency"]) ?? asText(holder["currency"]) ?? null;
  return {
    salary: {
      min,
      // A maximum below the minimum is a broken pair, not a range.
      max: max != null && min != null && max < min ? null : max,
      currency: currency ? currency.toUpperCase() : null,
    },
    period:
      normalizeSalaryPeriod(holder["unitText"]) ??
      normalizeSalaryPeriod(holder["unitCode"]) ??
      normalizeSalaryPeriod(node["unitText"]),
  };
}

function toAtsJob(
  node: JsonLdNode,
  pageUrl: string,
  now: Date,
  isSolePosting: boolean,
): AtsJob | null {
  const title = asText(node["title"]) ?? asText(node["name"]);
  if (!title) return null;

  // An expired posting is markup a board forgot to remove. Counting it would keep
  // a closed role open forever, and `validThrough` is the site's own statement
  // that it is gone — so it is the one field here that DROPS a posting.
  const validThrough = isoDate(node["validThrough"]);
  if (validThrough && new Date(validThrough).getTime() < now.getTime()) return null;

  const { salary, period } = baseSalary(node["baseSalary"]);
  const employmentType = nodeText(node["employmentType"]);
  const descriptionRaw = asText(node["description"]);
  // `url` is optional in practice: Teamtailor states none, because the posting IS
  // the page — but that only holds when the page states ONE posting. A listing
  // that inlines its whole board would otherwise give every role the same URL,
  // which is one identity for all of them and a board of one after dedup.
  const stated = canonicalJobUrl(asText(node["url"]) ?? "", pageUrl);
  const url = stated ?? (isSolePosting ? canonicalJobUrl(pageUrl) : null);

  return mkJob({
    title,
    // Only what the markup states. schema.org has no department field, and
    // `occupationalCategory` is the closest thing; when it is absent the raw
    // department stays empty and `normalizeDepartment` buckets from the title
    // downstream, which is a fallback, not an invention.
    department: nodeText(node["occupationalCategory"]) ?? "",
    location: locationOf(node),
    url,
    postedAt: isoDate(node["datePosted"]),
    salary,
    salaryPeriod: period,
    seniority: normalizeSeniority(title, employmentType),
    description: descriptionRaw ? htmlToPlainJd(unescapeMarkup(descriptionRaw)) || null : null,
    employmentType,
  });
}

/**
 * Every `JobPosting` the page's JSON-LD carries, as `AtsJob`s. Empty when the
 * markup is absent, unparseable or expired — the caller then falls through to the
 * next rung, never to a half-read board.
 *
 * `pageUrl` is the address the HTML was read from: it supplies the posting URL
 * for the (common) markup that states none.
 */
export function jobPostingsFromJsonLd(html: string, pageUrl: string, now = new Date()): AtsJob[] {
  const postings = expandItemLists(extractJsonLd(html)).filter((n) => hasType(n, "JobPosting"));
  const isSolePosting = postings.length === 1;
  const out: AtsJob[] = [];
  const seen = new Set<string>();
  for (const node of postings) {
    const job = toAtsJob(node, pageUrl, now, isSolePosting);
    if (!job) continue;
    // A page that states the same posting twice (a `@graph` plus a bare block is
    // a common CMS output) must not count it twice. Keyed on what the markup
    // ITSELF states, never on the page-URL fallback — that one is shared.
    const stated = canonicalJobUrl(asText(node["url"]) ?? "", pageUrl);
    const key = stated ?? `${job.title}|${job.location ?? ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(job);
  }
  return out;
}

// ── Listing → job-detail links ───────────────────────────────────────────────

// A path segment that introduces a job listing. The link only qualifies when a
// FURTHER segment follows it, which is what separates one posting
// (`/jobs/7986365-sanctions-lead`) from the index that lists them (`/jobs`).
const JOB_SEGMENTS = new Set([
  "job", "jobs", "opening", "openings", "position", "positions", "vacancy",
  "vacancies", "career", "careers", "role", "roles",
  // FR / DE / ES — the long tail this rung exists for is largely European.
  "offre", "offres", "emploi", "emplois", "poste", "postes", "recrutement",
  "stelle", "stellen", "stellenangebote", "karriere", "vagas", "vacante", "vacantes",
]);

// Segments that follow a job segment without being a posting: the board's own
// facets and utilities. Without this, "/jobs/search" enters the fetch budget on
// every run and never yields a posting.
const NON_POSTING_SEGMENTS = new Set([
  "search", "all", "index", "list", "filter", "filters", "page", "category",
  "categories", "department", "departments", "team", "teams", "location",
  "locations", "type", "types", "feed", "rss", "sitemap", "apply", "login",
  "new", "create", "alerts", "subscribe",
]);

/** Does this path look like ONE posting rather than a listing or a facet? */
function looksLikeJobDetail(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = (segments[i] ?? "").toLowerCase();
    const next = (segments[i + 1] ?? "").toLowerCase();
    if (!JOB_SEGMENTS.has(seg)) continue;
    if (NON_POSTING_SEGMENTS.has(next)) continue;
    // A file (`/jobs/index.html`, `/jobs.rss`) is never a posting.
    if (/\.(x?html?|rss|xml|json|pdf|ics)$/i.test(next)) continue;
    return true;
  }
  return false;
}

/**
 * The job-detail links a listing page points at, canonicalised, deduplicated and
 * in document order.
 *
 * SAME HOST ONLY. A careers page links to LinkedIn, to a job aggregator and to
 * the ATS of a sister company; following those would mix another company's roles
 * into this competitor's board, and the whole board's meaning depends on it being
 * one company's. The one hop across hosts the scraper does take (to the board
 * itself) is decided earlier, with its own evidence.
 */
export function jobDetailLinks(html: string, pageUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const self = canonicalJobUrl(pageUrl);
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: string[] = [];

  const consider = (raw: string | undefined): void => {
    if (!raw) return;
    const href = raw.trim();
    if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(href)) return;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      return;
    }
    if (abs.hostname.toLowerCase() !== base.hostname.toLowerCase()) return;
    if (!looksLikeJobDetail(abs.pathname)) return;
    const canonical = canonicalJobUrl(abs.toString());
    if (!canonical || canonical === self || seen.has(canonical)) return;
    seen.add(canonical);
    out.push(canonical);
  };

  $("a[href]").each((_i, el) => consider($(el).attr("href")));
  // A listing can also enumerate its postings as an `ItemList` of urls with no
  // anchor at all (the rows are rendered client-side). Same host rule, same shape
  // test — the markup is a different carrier for the identical claim.
  for (const node of expandItemLists(extractJsonLd(html))) {
    consider(asText(node["url"]) ?? undefined);
  }
  return out;
}

/** Longest card remainder still readable as a location line. */
const MAX_LOCATION_HINT = 80;

/**
 * The text of each job link's own card, keyed by canonical URL.
 *
 * A listing card prints things the posting's markup sometimes omits — where the
 * role is, which team it belongs to. This captures the card verbatim; deciding
 * what any of it MEANS is `cardLocationHint`'s job, and deliberately a narrow one.
 */
export function listingCardText(html: string, pageUrl: string): Map<string, string> {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return new Map();
  }
  const $ = cheerio.load(html);
  const out = new Map<string, string>();
  $("a[href]").each((_i, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (!href) return;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      return;
    }
    if (abs.hostname.toLowerCase() !== base.hostname.toLowerCase()) return;
    if (!looksLikeJobDetail(abs.pathname)) return;
    const key = canonicalJobUrl(abs.toString());
    if (!key || out.has(key)) return;
    const anchor = $(el);
    const text = (anchor.text() || anchor.parent().text() || "").replace(/\s+/g, " ").trim();
    if (text) out.set(key, text);
  });
  return out;
}

/**
 * What a listing card says about WHERE a role is, once its title is removed.
 *
 * Used only when the posting's own markup states no location at all. The
 * asymmetry with `department` is deliberate and worth stating: a location string
 * is handed to the offline resolver, which either pins it to a country or returns
 * `unknown` — a wrong guess is caught and costs nothing. A department has no such
 * check: it silently buckets the role, moves a hiring-velocity series, and there
 * is no later step that can notice. So the department of a posting whose markup
 * omits it stays empty and is derived from the TITLE by a fixed rule downstream,
 * rather than read off a card whose layout we would be assuming.
 *
 * Returns null unless what is left is short enough to plausibly be a location
 * line — a card remainder that is a paragraph is a card we did not understand.
 */
export function cardLocationHint(cardText: string, title: string): string | null {
  const withoutTitle = cardText.replace(title, " ").replace(/\s+/g, " ").trim();
  const cleaned = withoutTitle.replace(/^[\s·•\-–—|,/]+|[\s·•\-–—|,/]+$/g, "").trim();
  if (!cleaned || cleaned.length > MAX_LOCATION_HINT) return null;
  return cleaned;
}

/**
 * Listing pages this page points at, so a paginated board is read WHOLE.
 *
 * This matters more than it looks: on this rung the listing IS the statement of
 * which roles are open, so stopping on page 1 of a paginated board would report
 * every posting past it as closed. The caller therefore treats an unfinished walk
 * as a truncated board and hands back nothing at all, exactly as the ATS fetcher
 * does when a board outgrows its page cap.
 *
 * Only links the page ITSELF renders are followed — a `rel="next"`, or an anchor
 * whose query carries a page number. Guessing `?page=2` would be a request the
 * site never advertised, and on a board that ignores the parameter it silently
 * re-reads page 1 forever.
 */
export function nextListingLinks(html: string, pageUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: string[] = [];
  const currentPath = base.pathname.replace(/\/+$/, "").toLowerCase();

  $("a[href]").each((_i, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (!href) return;
    const rel = ($(el).attr("rel") ?? "").toLowerCase();
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      return;
    }
    if (abs.hostname.toLowerCase() !== base.hostname.toLowerCase()) return;
    const paged = /(^|&)(page|p|pg|offset|start)=\d+/i.test(abs.search.replace(/^\?/, ""));
    if (rel !== "next" && !paged) return;
    // A "next" that leaves the listing is navigation, not pagination.
    if (abs.pathname.replace(/\/+$/, "").toLowerCase() !== currentPath) return;
    const url = abs.toString();
    if (url === base.toString() || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  });
  return out;
}


