import * as cheerio from "cheerio";
import type { SourceType } from "@outrival/shared";

/**
 * Turns raw rendered HTML into a stable, diff-friendly representation of the
 * page's *visible content* — one logical block per line.
 *
 * Change detection used to hash + diff the raw HTML (only CSRF/nonce stripped).
 * That flips on every scrape because of churn the user never sees: CSS-in-JS
 * class hashes (`css-1a2b3c`), inline `<style>` blocks (Chakra/emotion vars),
 * SVG `<path d="…">` data, hydration `<script>` JSON, build-hashed asset URLs.
 * The LLM then "classifies" that noise into a phantom signal.
 *
 * This walks the DOM and emits ONLY text nodes (+ image alt). Attributes are
 * never read, so dynamic class names / inline styles / data-* are ignored by
 * construction; script/style/svg/etc. are dropped before the walk. The result
 * is the words a visitor would read — what we actually want to diff.
 *
 * Pure (cheerio only, no crawlee/playwright) so the worker can call it both on
 * the freshly scraped HTML and on the prior snapshot's HTML pulled from R2.
 * Deterministic: same HTML → same output → same hash.
 */
export function extractContent(html: string, sourceType?: SourceType): string {
  const $ = cheerio.load(html);

  // Head signals first: <title> + meta/OG description are high-signal marketing
  // copy and the clearest place a homepage messaging change shows up. Captured
  // before we strip <head>.
  const head: string[] = [
    $("title").first().text(),
    $('meta[name="description"]').attr("content") ?? "",
    $('meta[property="og:title"]').attr("content") ?? "",
    $('meta[property="og:description"]').attr("content") ?? "",
  ];

  // Strip everything that is not visible competitor content. Order matters only
  // for readability — all of these are removed wholesale.
  $(
    [
      "script",
      "style",
      "noscript",
      "svg",
      "template",
      "link",
      "meta",
      "head",
      "iframe",
      "object",
      "embed",
      "canvas",
      "[aria-hidden='true']",
      "[hidden]",
      // CSS-hidden content (mobile-menu duplicates, pre-rendered modals, A/B
      // variants). cheerio has no computed CSS, so we can only catch inline
      // hiding — but inline display:none/visibility:hidden is never visible, so
      // removing it is always correct and kills the most common duplication.
      "[style*='display:none']",
      "[style*='display: none']",
      "[style*='visibility:hidden']",
      "[style*='visibility: hidden']",
      // Common consent / cookie banners: they re-render and A/B independently of
      // the product, so they are pure change-detection noise. Conservative,
      // vendor-id-scoped list to avoid dropping real content.
      "#onetrust-consent-sdk",
      "#onetrust-banner-sdk",
      "#CybotCookiebotDialog",
      "#osano-cm-window",
      "[class*='cookie-banner']",
      "[id*='cookie-banner']",
    ].join(","),
  ).remove();

  // Site-level chrome (header / nav / footer) is identical on every page of a
  // site and is NOT what we track on a pricing / blog / jobs page — it only
  // generates phantom diffs: a sticky header, a desktop+mobile nav duplicated in
  // the DOM (so its text doubles, e.g. "ContactContact"), or a marketing nav link
  // added once and re-detected on every page that shares the nav. Strip it for
  // non-homepage sources. Homepage keeps it: its structured diff parses sections
  // itself and the relevance filter already absorbs nav churn.
  //
  // Only PAGE-level chrome is dropped — a <header>/<footer> nested inside an
  // <article>/<main> is real content (a blog post's title header, an article
  // byline footer), so anything under <main>/<article> is preserved.
  if (sourceType && sourceType !== "homepage") {
    $("header, nav, footer, [role='banner'], [role='navigation'], [role='contentinfo']").each(
      (_, el) => {
        if ($(el).closest("main, article").length === 0) $(el).remove();
      },
    );
  }

  const out: string[] = [];
  const body = $("body").toArray();
  const roots = body.length ? body : $.root().toArray();
  for (const node of roots) collect(node as DomNode, out);

  const isBloglike = sourceType === "blog" || sourceType === "changelog";
  const lines = toLines([...head, out.join("")], isBloglike);

  return lines.join("\n");
}

// A real homepage / blog / pricing page has hundreds–thousands of significant
// characters. Below this the extracted body is essentially empty, which in
// practice means a failed render or a soft-block returning a styled shell — not
// a competitor that genuinely deleted their whole page. Mirrors the significance
// floor used downstream so the two stages agree on "no real text".
const COLLAPSE_FLOOR = 30;

/**
 * True when extracted content is so sparse it almost certainly reflects a failed
 * render / soft-block rather than a real page. The caller uses it to suppress a
 * phantom "everything changed" diff (compare against the prior snapshot: only a
 * drop from real content → empty is a collapse, a consistently-empty monitor is
 * not). Deliberately strict so a genuinely minimalist page isn't misjudged.
 */
export function isContentCollapsed(content: string): boolean {
  const significant = content.replace(/[\s\d:/.\-,;()[\]{}_+@#'"«»|]/g, "").length;
  return significant < COLLAPSE_FLOOR;
}

// Minimal structural type for domhandler nodes (cheerio's parse output) — avoids
// pulling domhandler's types in as a direct dep.
interface DomNode {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: DomNode[];
}

// Block-level tags: emit a line break around them so adjacent blocks become
// separate lines instead of running together into one giant line (which would
// make diffLines useless — any block change would rewrite the whole line).
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "br", "button", "caption",
  "dd", "details", "dialog", "div", "dl", "dt", "fieldset", "figcaption",
  "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header",
  "hgroup", "hr", "label", "li", "main", "nav", "ol", "option", "p", "pre",
  "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr",
  "ul",
]);

function collect(node: DomNode, out: string[]): void {
  if (node.type === "text") {
    if (node.data) out.push(node.data);
    return;
  }
  if (node.type !== "tag") return;
  const tag = (node.name ?? "").toLowerCase();
  if (tag === "img") {
    const alt = node.attribs?.alt?.trim();
    if (alt) out.push(` ${alt} `);
    return;
  }
  const block = BLOCK_TAGS.has(tag);
  if (block) out.push("\n");
  for (const child of node.children ?? []) collect(child, out);
  if (block) out.push("\n");
}

function toLines(segments: string[], isBloglike: boolean): string[] {
  const result: string[] = [];
  for (const segment of segments) {
    for (const rawLine of segment.split("\n")) {
      let line = normalizeVolatile(rawLine.replace(/\s+/g, " ").trim());
      if (isBloglike) line = stripBlogNoise(line);
      if (!line) continue;
      // Drop consecutive duplicates (mega-menus, repeated nav, sticky headers).
      if (line === result[result.length - 1]) continue;
      result.push(line);
    }
  }
  return result;
}

// Time-unit names across the languages competitors localise to (EN + the main
// EU languages). Only ever matched inside a number/article-anchored relative-date
// pattern, so the breadth here can never neutralise a real word on its own.
const REL_UNITS = [
  // English
  "seconds?", "minutes?", "hours?", "days?", "weeks?", "months?", "years?",
  // French — "il y a 8 jours"
  "secondes?", "heures?", "jours?", "semaines?", "mois", "ans?", "années?",
  // German — "vor 3 Tagen"
  "sekunden?", "minuten?", "stunden?", "tag(?:en)?", "wochen?", "monat(?:en)?", "jahr(?:en)?",
  // Spanish — "hace 2 días"
  "segundos?", "minutos?", "horas?", "d[ií]as?", "semanas?", "mes(?:es)?", "años?",
].join("|");

// Quantity: a number or a singular article ("a day ago", "il y a un mois",
// "vor einer Stunde", "hace una hora"). Worded numerals (deux/trois…) are left
// out — the numeric form covers the overwhelming majority.
const REL_QTY = "\\d+|une?|an?|eine?|einer|einem|una";

// Prefix-form relative dates: "<since> <qty> <unit>". One compiled regex reused
// across calls (String.replace resets a global regex's lastIndex, so it's safe).
const REL_PREFIX_RE = new RegExp(
  `\\b(?:il y a|vor|hace|in|about)\\s+(?:${REL_QTY})\\s+(?:${REL_UNITS})\\b`,
  "gi",
);

/**
 * Neutralises content that legitimately changes between two captures of an
 * otherwise-unchanged page — the #1 source of phantom changes on jobs/blog/
 * changelog pages, where a "posted N days ago" label recomputes on every scrape.
 *
 * Deliberately narrow: every rule is anchored on a number (or a singular
 * article) + an explicit time unit, so bare numbers carry real signal (a $10 →
 * $20 price, a plan limit, a metric) and are never touched. Multi-language
 * because competitors localise — a French careers page shows "il y a 8 jours",
 * not "8 days ago".
 */
function normalizeVolatile(line: string): string {
  return line
    // Suffix form (EN): "2 hours ago", "a day ago", "an hour ago".
    .replace(
      /\b(?:\d+|an?)\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/gi,
      "«ago»",
    )
    // Prefix form: FR "il y a 8 jours", DE "vor 3 Tagen", ES "hace 2 días",
    // EN "in 5 minutes" / "about 2 hours".
    .replace(REL_PREFIX_RE, "«rel»")
    // "© 2026", "Copyright 2024-2026" → constant year.
    .replace(/(©|copyright)\s*\d{4}(\s*[-–]\s*\d{4})?/gi, "$1 «year»");
}

// Blog/changelog index chrome that rotates without the post set changing.
// Stripped as substrings (not whole-line) because these badges are inline
// siblings that concatenate into one line without spaces ("3 min read1.2k
// views"). A number prefix is required, so real titles ("Product views") stay.
function stripBlogNoise(line: string): string {
  return line
    .replace(/[\d.,]+\s*[km]?\s+min(?:ute)?s?\s+read/gi, "")
    .replace(/[\d.,]+\s*[km]?\s+views?/gi, "")
    .replace(/[\d.,]+\s*[km]?\s+(?:likes?|comments?|shares?)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
