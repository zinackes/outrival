import * as cheerio from "cheerio";

/**
 * Read the posts off a blog INDEX page (Content Intelligence v2 P2).
 *
 * A feed hands out ids, titles and dates; a rendered listing hands out anchors,
 * and most of those anchors are navigation. This is the conservative half of the
 * blog source: it would rather return nothing than return a category page, because
 * every URL it returns is a row in `content_items` and a page we will go and fetch.
 *
 * Three filters carry that:
 *  - SAME HOST. A blog index links to Twitter, to a docs site, to a customer. Only
 *    the site's own pages are its posts.
 *  - POST-SHAPED PATH. Either strictly deeper than the index's own path
 *    (/blog → /blog/how-we-ship) or matching a conventional post prefix, so a
 *    footer link to /pricing is never filed as a publication.
 *  - NOT A TAXONOMY. /category/, /tag/, /author/, /page/2 and the index itself are
 *    listings OF posts, not posts, and they change every time anything is
 *    published — filing them would make the blog re-announce itself weekly.
 *
 * Identity is the CANONICAL url: query and fragment stripped, trailing slash
 * dropped. A listing links the same post as `?utm_source=nav` from one place and
 * bare from another, and two rows for one post is two publications that never
 * happened.
 *
 * PURE: no I/O, no DB, no AI.
 */

/** Anchors read off one index page, before dedup. A blog index shows tens. */
const MAX_CANDIDATES = 400;
/** Posts kept from one capture. Deeper than any reasonable index page. */
const MAX_POSTS = 60;
/** A shorter anchor text is a "Read more" chevron, not a title. */
const MIN_TITLE_CHARS = 12;

/** Conventional post prefixes, for blogs whose posts do not live under the index. */
const POST_PATH_RE =
  /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:blog|news|posts?|articles?|insights?|stories|resources|updates)\/[^/]+/i;

/** Listings OF posts, and everything that is not a page at all. */
const EXCLUDED_RE = [
  /\/(?:category|categories|tag|tags|topic|topics|author|authors|archive|archives)(?:\/|$)/i,
  /\/page\/\d+\/?$/i,
  /\/(?:feed|rss|atom)(?:\/|$)/i,
  /\.(?:xml|json|rss|atom|pdf|zip|png|jpe?g|gif|svg|webp|mp4|mp3)$/i,
];

export interface BlogPostLink {
  /** Canonical absolute URL — the identity of the post. */
  url: string;
  title: string;
  /** ISO string when the listing printed a machine-readable date, else null. */
  publishedAt: string | null;
}

/**
 * Canonical form of a URL: lowercased host, no query, no fragment, no trailing
 * slash. Returns null when the input is not an http(s) URL.
 */
export function canonicalizeUrl(raw: string, base?: string): string | null {
  let u: URL;
  try {
    u = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  u.search = "";
  u.hostname = u.hostname.toLowerCase();
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }
  return u.toString();
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "/";
  }
}

/** Is `candidate` a page BELOW `index`, rather than the index or a sibling? */
function isDeeperThan(candidate: string, index: string): boolean {
  const idx = pathOf(index);
  if (idx === "/") return false; // every page is "below" the root — proves nothing
  const cand = pathOf(candidate);
  return cand.startsWith(`${idx}/`) && cand.length > idx.length + 1;
}

/** A machine-readable date, or null when the string is not one. */
function toIso(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The posts this index page links to, newest-first as the page ordered them.
 *
 * `indexUrl` is the page these anchors were read off — the resolution base, the
 * host gate, and the path the "deeper than the index" test measures against.
 */
export function extractPostLinks(html: string, indexUrl: string): BlogPostLink[] {
  let host: string;
  try {
    host = new URL(indexUrl).hostname.toLowerCase();
  } catch {
    return [];
  }

  const $ = cheerio.load(html);
  // Anchors a listing puts its posts in. `article a` and heading links cover the
  // overwhelming majority of blog templates; the bare `a[href]` sweep is what
  // catches the rest, and it is safe only because every filter below still runs.
  const anchors = $("article a[href], h1 a[href], h2 a[href], h3 a[href], a[href]")
    .toArray()
    .slice(0, MAX_CANDIDATES);

  const byUrl = new Map<string, BlogPostLink>();
  const out: BlogPostLink[] = [];
  const indexCanonical = canonicalizeUrl(indexUrl);

  for (const el of anchors) {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) continue;

    const url = canonicalizeUrl(href, indexUrl);
    if (!url || url === indexCanonical) continue;
    try {
      if (new URL(url).hostname.toLowerCase() !== host) continue;
    } catch {
      continue;
    }
    if (EXCLUDED_RE.some((re) => re.test(url))) continue;
    if (!isDeeperThan(url, indexUrl) && !POST_PATH_RE.test(pathOf(url))) continue;

    // The date the listing printed next to this post, when it printed a
    // machine-readable one. Inside the anchor first, then the card around it.
    const anchor = $(el);
    const publishedAt =
      toIso(anchor.find("time[datetime]").attr("datetime")) ??
      toIso(
        anchor
          .closest("article, li, .post, .entry, div")
          .find("time[datetime]")
          .first()
          .attr("datetime"),
      );

    // The same post, linked twice. A "Recent posts" sidebar carries the NEWEST
    // posts as bare list items with no date beside them, and it is rendered
    // BEFORE the listing — so the first anchor for a recent post is routinely
    // the undated one, and keeping it dated the post from the day we scraped.
    // Whichever anchor came first, the dated one is the one that knows when the
    // post was published.
    const known = byUrl.get(url);
    if (known) {
      if (!known.publishedAt && publishedAt) known.publishedAt = publishedAt;
      continue;
    }

    // The anchor's own words are the title. An image-only card carries it in the
    // alt text; an anchor with neither says nothing, and a row needs a title.
    const title = ($(el).text().replace(/\s+/g, " ").trim() ||
      $(el).find("img[alt]").first().attr("alt")?.trim() ||
      "") as string;
    if (title.length < MIN_TITLE_CHARS) continue;

    const link: BlogPostLink = { url, title, publishedAt };
    byUrl.set(url, link);
    out.push(link);
    if (out.length >= MAX_POSTS) break;
  }

  return out;
}
