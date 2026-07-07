import * as cheerio from "cheerio";

// L3 product-line aggregation (docs/pricing-coverage-2026.md Part II). Catalog
// sites (hosting, e-commerce) split pricing across product pages / a store
// subdomain. The pricing scraper captures the top-K priced pages and stitches
// them into ONE snapshot with per-line <section> delimiters, so the pipeline stays
// single-snapshot (diff/change intact) while extraction attributes each plan to its
// product line. Competitor-agnostic: line names come from the URL/heading, no branch.

const DATA_LINE_ATTR = "data-outrival-line";
const MAX_LINE_LEN = 40;

/** A generic product line name from a page URL (last meaningful path segment),
 *  falling back to the page's <h1>. "/vps-hosting" → "Vps hosting", "/games/rust"
 *  → "Rust", "/products/vps" → "Vps". Pure. */
export function deriveProductLine(url: string, html?: string): string {
  const seg = lastMeaningfulSegment(url);
  if (seg) return titleize(seg).slice(0, MAX_LINE_LEN);
  if (html) {
    const h1 = cheerio.load(html)("h1").first().text().trim().replace(/\s+/g, " ");
    if (h1) return h1.slice(0, MAX_LINE_LEN);
  }
  return "Plans";
}

function lastMeaningfulSegment(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const parts = u.pathname
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^(index|home|en|fr|de|es|it|www|products?|produits?)$/i.test(s));
  const last = parts[parts.length - 1];
  if (!last) return null;
  return last.replace(/\.(html?|php|aspx?)$/i, "");
}

function titleize(seg: string): string {
  let s: string;
  try {
    s = decodeURIComponent(seg);
  } catch {
    s = seg;
  }
  s = s.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Stitch captured product pages into one delimited document. Each part's <body>
 * inner HTML is wrapped in a `<section data-outrival-line="…">` so `splitProductLines`
 * can recover the boundaries downstream. Pure.
 */
export function buildAggregatedDocument(parts: { line: string; html: string }[]): string {
  const sections = parts
    .map(
      (p) =>
        `<section ${DATA_LINE_ATTR}="${escapeAttr(p.line)}">\n${bodyInner(p.html)}\n</section>`,
    )
    .join("\n");
  return `<!doctype html><html><body>\n${sections}\n</body></html>`;
}

/**
 * Split an aggregated snapshot back into per-line sections. A plain (non-aggregated)
 * snapshot has no markers → a single section with `line: null`, i.e. exactly the
 * pre-aggregation single-page behaviour. Pure.
 */
export function splitProductLines(html: string): { line: string | null; html: string }[] {
  const $ = cheerio.load(html);
  const sections = $(`[${DATA_LINE_ATTR}]`);
  if (sections.length === 0) return [{ line: null, html }];
  const out: { line: string | null; html: string }[] = [];
  sections.each((_, el) => {
    const $el = $(el);
    out.push({ line: $el.attr(DATA_LINE_ATTR) || null, html: $.html($el) });
  });
  return out;
}

function bodyInner(html: string): string {
  const $ = cheerio.load(html);
  const body = $("body");
  return (body.length ? body.html() : $.root().html()) ?? html;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
