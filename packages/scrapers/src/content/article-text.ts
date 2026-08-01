import * as cheerio from "cheerio";
import { extractContent } from "../lib/extract-content";

/**
 * The readable text of ONE fetched blog post (Content Intelligence v2 P2).
 *
 * `extractContent` already turns a page into the words a visitor would read, and
 * it already drops page-level nav/header/footer for non-homepage sources — so it
 * does the work here rather than a second extractor being written next to it. What
 * it does NOT do is choose between the article and everything around it, because
 * it was built to diff a whole page: on a post that means the related-posts rail
 * and the newsletter box land in the text the model reads, and a competitor named
 * in a sidebar card becomes a competitor named in the post.
 *
 * So this scopes first — `<article>`, then `[role=main]`/`<main>` — and hands that
 * subtree to the existing helper. No scope found (a hand-rolled `<div>` layout)
 * falls back to the whole document, which is exactly today's behaviour and still
 * strips chrome.
 *
 * PURE: no I/O, no DB, no AI.
 */

/** What the model sees of one post. A long-form post fits; a docs dump does not. */
export const MAX_POST_TEXT_CHARS = 12_000;

/** Under this the "article" we found is a teaser card, not the post. */
const MIN_SCOPE_CHARS = 400;

export function extractArticleText(html: string): string {
  const $ = cheerio.load(html);

  // The biggest <article> — a listing-styled post page can carry several, and the
  // post is the long one. Then the main landmark. Then nothing, and we take the page.
  let scope: string | null = null;
  let best = 0;
  for (const el of $("article").toArray()) {
    const len = $(el).text().replace(/\s+/g, " ").trim().length;
    if (len > best) {
      best = len;
      scope = $.html(el);
    }
  }
  if (best < MIN_SCOPE_CHARS) {
    const main = $("[role='main']").first().length ? $("[role='main']").first() : $("main").first();
    const mainLen = main.length ? main.text().replace(/\s+/g, " ").trim().length : 0;
    scope = mainLen >= MIN_SCOPE_CHARS ? $.html(main) : null;
  }

  // "blog" so the helper strips the read-time / view-count badges a post carries,
  // and drops the page-level chrome when we had to fall back to the whole document.
  return extractContent(scope ?? html, "blog").slice(0, MAX_POST_TEXT_CHARS);
}
