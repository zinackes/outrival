/**
 * Hacker News tracking (product-launch + traction signal). Two things a competitor
 * does on HN are worth a signal: (1) a "Show HN" of their own product — a launch
 * often announced weeks before the official press release — and (2) a story that
 * *mentions* the competitor and gains real traction. We query HN's public Algolia
 * search (no key, no auth), apply a strict anti-homonym guard (the whole risk of
 * this source: "Notion", "Linear", "Arc", "Ramp" are common words), and render a
 * DETERMINISTIC snapshot whose JSON island carries every guard-passing hit. The
 * scrape-monitor hackernews branch then diffs objectID sets across snapshots and
 * forces the severity per hit (Show HN → product/high, traction → content/medium);
 * this module is pure parsing + classification, mirroring the AI-free-leaf rule.
 */
import { normalizeHostname } from "@outrival/shared";
import type { SignalCategory, SignalSeverity } from "@outrival/shared";

/** Default points a mention must exceed to count as "gaining traction". */
export const HN_POINTS_THRESHOLD_DEFAULT = 50;
/** Default recency window (days) — bounds the incremental fetch (PIÈGE 1: caps hits). */
export const HN_WINDOW_DAYS_DEFAULT = 30;

/** The canonical HN thread URL — the proof always attached to a HN signal. */
export function hnThreadUrl(objectID: string): string {
  return `https://news.ycombinator.com/item?id=${objectID}`;
}

/**
 * HN Algolia `search_by_date` endpoint — sorted by date (the incremental-veille
 * endpoint), scoped to stories (Show HN is a story carrying the `show_hn` _tag, so
 * `tags=story` returns both), bounded to hits created after `sinceEpoch` so a
 * heavily-mentioned competitor never hits the hard 1000-hit ceiling. No key, no auth.
 */
export function algoliaSearchUrl(query: string, sinceEpoch: number): string {
  const q = encodeURIComponent(query);
  const filter = encodeURIComponent(`created_at_i>${Math.floor(sinceEpoch)}`);
  return `https://hn.algolia.com/api/v1/search_by_date?query=${q}&tags=story&numericFilters=${filter}&hitsPerPage=1000`;
}

/** A raw Algolia hit — only the fields we consume, everything else ignored. */
export interface RawHit {
  objectID: string;
  title: string | null;
  url: string | null;
  author: string | null;
  points: number | null;
  num_comments: number | null;
  created_at_i: number | null;
  _tags: string[];
}

/**
 * Parse an Algolia `search_by_date` payload into raw hits. Tolerant: a malformed
 * body or missing `hits` yields [] (the caller then emits an empty — valid —
 * snapshot). Pure, no throw.
 */
export function parseAlgoliaHits(json: unknown): RawHit[] {
  const hits = (json as { hits?: unknown })?.hits;
  if (!Array.isArray(hits)) return [];
  const out: RawHit[] = [];
  for (const h of hits) {
    if (!h || typeof h !== "object") continue;
    const o = h as Record<string, unknown>;
    const objectID = typeof o.objectID === "string" ? o.objectID : null;
    if (!objectID) continue;
    out.push({
      objectID,
      title: typeof o.title === "string" ? o.title : null,
      url: typeof o.url === "string" ? o.url : null,
      author: typeof o.author === "string" ? o.author : null,
      points: typeof o.points === "number" ? o.points : null,
      num_comments: typeof o.num_comments === "number" ? o.num_comments : null,
      created_at_i: typeof o.created_at_i === "number" ? o.created_at_i : null,
      _tags: Array.isArray(o._tags) ? o._tags.filter((t): t is string => typeof t === "string") : [],
    });
  }
  return out;
}

/** A guard-passing, classified hit — the unit the snapshot + objectID-diff track. */
export interface HackerNewsHit {
  objectID: string;
  title: string;
  /** The story's outbound URL (null for text/Ask-style posts). */
  url: string | null;
  /** The HN discussion thread — always present, always the signal's proof link. */
  threadUrl: string;
  author: string | null;
  points: number;
  numComments: number;
  createdAtEpoch: number | null;
  /**
   * show_hn      → the competitor's own launch (product/high) — the premium signal.
   * traction     → a mention above the points threshold (content/medium).
   * below_threshold → guard-passing but quiet; stored, never signalled.
   */
  kind: "show_hn" | "traction" | "below_threshold";
  /** Forced signal category — deterministic, never the classifier's call. */
  category: SignalCategory;
  /** Forced signal severity — deterministic. */
  severity: SignalSeverity;
}

/** A kind that warrants a signal (below_threshold is stored but silent). */
export function isQualifying(kind: HackerNewsHit["kind"]): boolean {
  return kind === "show_hn" || kind === "traction";
}

/**
 * The genuinely-new signal-worthy hits: current qualifying hits whose objectID was
 * NOT already qualifying in the previous snapshot. This is the dedup by stored
 * objectID — a post never yields a second signal, even if the job re-runs, because
 * its objectID is already in the prior qualifying set. A below_threshold hit that
 * later crosses the points threshold DOES surface here (it was not qualifying
 * before), which is the desired "gained traction" signal. Pure.
 */
export function newQualifyingHits(
  priorHits: HackerNewsHit[],
  currentHits: HackerNewsHit[],
): HackerNewsHit[] {
  const priorQualifying = new Set(
    priorHits.filter((h) => isQualifying(h.kind)).map((h) => h.objectID),
  );
  return currentHits.filter((h) => isQualifying(h.kind) && !priorQualifying.has(h.objectID));
}

function normalizeText(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

/** The registrable domain of a hit's outbound URL, or null (text posts / bad url). */
function hitDomain(url: string | null): string | null {
  return url ? normalizeHostname(url) : null;
}

/** Does the competitor NAME appear as a whole word in the title? (homonym-prone). */
function nameInTitle(title: string, name: string): boolean {
  const needle = normalizeText(name);
  if (!needle) return false;
  const hay = normalizeText(title);
  return hay === needle || hay.startsWith(`${needle} `) || hay.endsWith(` ${needle}`) ||
    hay.includes(` ${needle} `);
}

export interface ClassifyOptions {
  /** Competitor display name (from options.competitorName, falls back to brand). */
  name: string;
  /** Competitor registrable domain (eTLD+1) — the strict guard's anchor. */
  domain: string | null;
  /**
   * When the name is a common word (Notion/Linear/Arc/Ramp…), the name-in-title
   * branch is dropped and the domain is REQUIRED. Default true (strict) — the
   * lenient branch only opens when the user explicitly confirmed the name is safe
   * (competitor.metadata.ambiguousName === false → passed here as false).
   */
  ambiguousName?: boolean;
  /** Points a mention must exceed to be "traction". */
  pointsThreshold?: number;
}

/**
 * Apply the anti-homonym guard and classify each surviving hit. A hit only counts
 * when the competitor DOMAIN appears in its url, OR — for a name confirmed
 * unambiguous — the NAME appears in its title. Show HN is premium only when the
 * domain also matches (a "Show HN" linking a third-party repo is not the
 * competitor's launch). Sorted by objectID for a deterministic snapshot. Pure.
 */
export function classifyHits(hits: RawHit[], opts: ClassifyOptions): HackerNewsHit[] {
  const { name, domain } = opts;
  const ambiguous = opts.ambiguousName !== false; // default strict
  const threshold = opts.pointsThreshold ?? HN_POINTS_THRESHOLD_DEFAULT;

  const out: HackerNewsHit[] = [];
  for (const h of hits) {
    const title = (h.title ?? "").trim();
    if (!title) continue;

    const domainMatch = domain != null && hitDomain(h.url) === domain;
    // Strict (ambiguous): the domain is mandatory. Lenient: domain OR name-in-title.
    const passes = ambiguous ? domainMatch : domainMatch || nameInTitle(title, name);
    if (!passes) continue;

    const isShowHn = h._tags.includes("show_hn");
    const points = h.points ?? 0;

    let kind: HackerNewsHit["kind"];
    let category: SignalCategory;
    let severity: SignalSeverity;
    if (isShowHn && domainMatch) {
      kind = "show_hn";
      category = "product";
      severity = "high";
    } else if (points > threshold) {
      kind = "traction";
      category = "content";
      severity = "medium";
    } else {
      kind = "below_threshold";
      category = "content";
      severity = "low";
    }

    out.push({
      objectID: h.objectID,
      title,
      url: h.url,
      threadUrl: hnThreadUrl(h.objectID),
      author: h.author,
      points,
      numComments: h.num_comments ?? 0,
      createdAtEpoch: h.created_at_i,
      kind,
      category,
      severity,
    });
  }
  out.sort((a, b) => a.objectID.localeCompare(b.objectID));
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const MARKER = "outrival-hackernews-hits";

/**
 * The strategic diff line the eventual signal insight reads — names the meaning,
 * carries the proof thread URL. Points live here (not in the hashed line) so the
 * insight is grounded, but a points tick never fabricates a change.
 */
export function annotateLine(name: string, hit: HackerNewsHit): string {
  const meta = `${hit.points} points, ${hit.numComments} comments`;
  if (hit.kind === "show_hn") {
    return `Show HN launch by ${name}: "${hit.title}" (${meta}) — the competitor's own product launched on Hacker News, often weeks before the official press release. Thread: ${hit.threadUrl}`;
  }
  if (hit.kind === "traction") {
    return `Hacker News discussion gaining traction (${meta}): "${hit.title}" — ${name} mentioned. Thread: ${hit.threadUrl}`;
  }
  return `Hacker News mention (${meta}): "${hit.title}". Thread: ${hit.threadUrl}`;
}

/**
 * Deterministic snapshot. The VISIBLE, hashed line is `{objectID} {kind} {title}`
 * — stable when the qualifying set and band membership don't move (points churn is
 * excluded, so a climbing score never re-snapshots). The JSON island carries EVERY
 * guard-passing hit (points, url, thread, forced category/severity) — the source of
 * truth for the scrape-monitor objectID-set diff and the signal grounding. Sorted
 * by objectID so an unchanged set yields a constant content hash.
 */
export function buildHackerNewsDoc(
  name: string,
  hits: HackerNewsHit[],
): { html: string; text: string } {
  const sorted = [...hits].sort((a, b) => a.objectID.localeCompare(b.objectID));
  const qualifying = sorted.filter((h) => isQualifying(h.kind)).length;

  // A verbose, STABLE header (only name/counts move) — its constant text clears
  // extractContent's COLLAPSE_FLOOR (30 significant chars) even for a 0-hit,
  // short-named competitor, so an empty HN presence is never mis-graded as a
  // collapsed/failed capture (which would throw → mass markedUnscrapable).
  const header = `Hacker News mentions and Show HN launches for ${name}: ${sorted.length} tracked, ${qualifying} signalling`;
  const lis = sorted
    .map((h) => `<li data-hn-id="${escapeHtml(h.objectID)}" data-hn-kind="${h.kind}">${escapeHtml(h.kind)}: ${escapeHtml(h.title)}</li>`)
    .join("");
  const json = JSON.stringify({ name, hits: sorted }).replace(/</g, "\\u003c");
  const html =
    `<!doctype html><html><body><section data-outrival-hackernews>` +
    `<h2>${escapeHtml(header)}</h2>` +
    `<ul>${lis}</ul></section>` +
    `<script type="application/json" id="${MARKER}">${json}</script></body></html>`;
  const text =
    `${header}\n` +
    sorted.map((h) => `${h.objectID} ${h.kind} ${h.title}`).join("\n");
  return { html, text };
}

/**
 * Read a HN snapshot's JSON island back into hits — used by the scrape-monitor
 * branch to recover the PREVIOUS run's qualifying objectIDs for the dedup diff.
 * Tolerant: a snapshot without the island (or malformed) yields []. Pure.
 */
export function parseDocHits(html: string): HackerNewsHit[] {
  const m = new RegExp(
    `<script[^>]*id=["']${MARKER}["'][^>]*>([\\s\\S]*?)</script>`,
    "i",
  ).exec(html);
  if (!m?.[1]) return [];
  try {
    const parsed = JSON.parse(m[1].replace(/\\u003c/g, "<")) as { hits?: unknown };
    if (!Array.isArray(parsed.hits)) return [];
    return parsed.hits as HackerNewsHit[];
  } catch {
    return [];
  }
}
