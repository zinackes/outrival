/**
 * RSS 2.0 / Atom feed parsing (patch-32, changelog signal). When a changelog (or
 * blog) page advertises a native feed, parsing it structured-first beats diffing
 * rendered HTML: each entry carries a title, link and publish date, so "new
 * release entries since last run" is exact and AI-free — a clean product-velocity
 * signal. Pure regex (no XML dep), mirroring the AI-free-leaf rule of this package.
 */

export interface FeedItem {
  title: string;
  link: string | null;
  /** ISO date string when parseable, else null. */
  publishedAt: string | null;
  /** Stable identity: guid / atom id / link / title (first non-empty). */
  id: string;
  summary: string | null;
}

/** Read the first `<tag …>…</tag>` text in a block, unwrapping CDATA. */
function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
  if (!m?.[1]) return "";
  return decode(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
}

/** Read an attribute off the first matching tag, e.g. Atom `<link href="…"/>`. */
function attr(block: string, name: string, attrName: string): string {
  const m = new RegExp(`<${name}\\b[^>]*\\b${attrName}=["']([^"']+)["']`, "i").exec(block);
  return m?.[1] ? decode(m[1]).trim() : "";
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function toIso(raw: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function blocks(xml: string, name: string): string[] {
  return xml.match(new RegExp(`<${name}\\b[\\s\\S]*?</${name}>`, "gi")) ?? [];
}

/**
 * Parse an RSS 2.0 or Atom feed into normalized items, newest-first as published
 * by the feed (order preserved). Returns [] when the payload is not a feed.
 */
export function parseFeed(xml: string): FeedItem[] {
  if (!/<rss\b|<feed\b|<rdf:RDF\b/i.test(xml)) return [];

  // Atom <entry> when present, else RSS/RDF <item>.
  const isAtom = /<feed\b[^>]*xmlns=["'][^"']*Atom/i.test(xml) || /<entry\b/i.test(xml);
  const items = isAtom ? blocks(xml, "entry") : blocks(xml, "item");

  const out: FeedItem[] = [];
  for (const b of items) {
    const title = tag(b, "title");
    if (!title) continue;
    const link = isAtom ? attr(b, "link", "href") || tag(b, "id") : tag(b, "link") || tag(b, "guid");
    const published =
      tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date");
    const id = tag(b, "guid") || tag(b, "id") || link || title;
    const summary = tag(b, "description") || tag(b, "summary") || tag(b, "content") || null;
    out.push({
      title,
      link: link || null,
      publishedAt: toIso(published),
      id,
      summary: summary ? summary.slice(0, 500) : null,
    });
  }
  return out;
}

/**
 * Discover a feed URL advertised by an HTML page: a `<link rel="alternate">` with
 * an RSS/Atom type, resolved absolute. Null when the page advertises none (the
 * caller then falls back to HTML change-detection). Pure.
 */
export function discoverFeedUrl(html: string, baseUrl: string): string | null {
  const linkRe = /<link\b[^>]*>/gi;
  for (const m of html.matchAll(linkRe)) {
    const linkTag = m[0];
    if (!/rel=["']alternate["']/i.test(linkTag)) continue;
    if (!/type=["']application\/(rss|atom)\+xml["']/i.test(linkTag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(linkTag)?.[1];
    if (!href) continue;
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      /* skip malformed href */
    }
  }
  return null;
}
