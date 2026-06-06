/**
 * Reddit mention tracking (patch-32). Reddit is NOT a product-review site with a
 * star rating — it's discussion. So instead of an AggregateRating we collect recent
 * MENTIONS of the competitor via Reddit's public search JSON (no auth), render them
 * into a deterministic document, and let extract-reviews judge sentiment + recurring
 * complaint themes ("complaints = opportunities"). No fabricated /5 score: the source
 * carries sentiment + verbatims only. Pure parsing here; the fetch lives in the scraper.
 */

export interface RedditMention {
  id: string;
  title: string;
  subreddit: string;
  /** Net upvotes (a proxy for reach). */
  score: number;
  numComments: number;
  permalink: string;
  createdUtc: number;
  body: string;
}

/** Public Reddit search endpoint (read-only, no auth). Quote the term for precision. */
export function redditSearchUrl(query: string, limit = 25): string {
  const q = encodeURIComponent(`"${query}"`);
  return `https://www.reddit.com/search.json?q=${q}&sort=relevance&t=year&limit=${limit}`;
}

function str(x: unknown): string {
  return typeof x === "string" ? x.trim() : "";
}
function num(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

/** Parse a Reddit listing JSON (search.json / r/<sub>/search.json) into mentions. */
export function parseRedditSearch(json: unknown): RedditMention[] {
  const children = (json as { data?: { children?: unknown } })?.data?.children;
  if (!Array.isArray(children)) return [];
  const out: RedditMention[] = [];
  for (const child of children) {
    const d = (child as { data?: Record<string, unknown> })?.data;
    if (!d) continue;
    const title = str(d.title);
    const id = str(d.id) || str(d.name);
    if (!title || !id) continue;
    out.push({
      id,
      title,
      subreddit: str(d.subreddit),
      score: num(d.score),
      numComments: num(d.num_comments),
      permalink: str(d.permalink),
      createdUtc: num(d.created_utc),
      body: str(d.selftext).slice(0, 600),
    });
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const MARKER = "outrival-reddit-mentions";

/**
 * Render mentions into a stable snapshot: sorted by id so an unchanged result set
 * yields a constant content hash (no phantom change; the lexical diff then surfaces
 * genuinely new mentions). Carries a JSON island for any downstream structured use.
 */
export function buildRedditDoc(query: string, mentions: RedditMention[]): { html: string; text: string } {
  const sorted = [...mentions].sort((a, b) => a.id.localeCompare(b.id));
  const lis = sorted
    .map((m) => {
      const meta = `r/${m.subreddit} · ${m.score}↑ · ${m.numComments}💬`;
      const body = m.body ? ` — ${escapeHtml(m.body)}` : "";
      return `<li>[${escapeHtml(meta)}] ${escapeHtml(m.title)}${body}</li>`;
    })
    .join("");
  const json = JSON.stringify({ query, mentions: sorted }).replace(/</g, "\\u003c");
  const html =
    `<!doctype html><html><body><section data-outrival-reddit><h2>Reddit mentions of ${escapeHtml(query)} (${sorted.length})</h2><ul>${lis}</ul></section>` +
    `<script type="application/json" id="${MARKER}">${json}</script></body></html>`;
  const text = sorted
    .map((m) => `[r/${m.subreddit} · ${m.score} upvotes · ${m.numComments} comments] ${m.title}\n${m.body}`)
    .join("\n\n");
  return { html, text };
}
