import { safeFetch } from "../lib/guarded-fetch";
import { realisticHeaders, OUTRIVAL_UA } from "../lib/fingerprint";
import { isAllowed, getCrawlDelayMs } from "../lib/robots";
import { awaitDomainSlot } from "../lib/rate-limit";
import { extractArticleText } from "./article-text";

/**
 * Fetch the posts a blog just published (Content Intelligence v2 P2).
 *
 * The blog source used to capture its INDEX and diff it, which is how a competitor
 * publishing a teardown of your product read as "3 lines added". Reading the posts
 * means going and getting them, and going and getting them is the part that has to
 * stay small: one light request per NEW post, never a re-read, capped per run,
 * one at a time.
 *
 * Everything the collection doctrine asks of a scrape applies here unchanged,
 * because this IS a scrape: robots.txt is consulted before the first request, the
 * UA names the bot, and the per-domain gap (2s, or the site's own Crawl-delay) is
 * awaited between posts. That gap plus the sequential loop IS the pacing — there
 * is no second, private delay to keep in sync with it.
 *
 * A post we cannot read is not an error. It stays unenriched, gets one more try on
 * a later run, and is then left alone: a paywalled or JS-only post is a fact about
 * that post, and re-fetching it weekly forever would be us not listening.
 */

/** Posts fetched in one run. The rest are picked up by the next capture. */
export const POST_FETCH_CAP = 20;
/**
 * A blog post is prose. Past this the URL is a document dump, an export or a
 * mis-routed asset, and reading it costs more than it can possibly say.
 */
export const MAX_POST_BYTES = 500 * 1024;
/** Short: this is a courtesy read of a marketing page, not a monitored capture. */
export const POST_FETCH_TIMEOUT_MS = 8_000;
/** Fetch attempts a post gets across runs before we stop asking. */
export const POST_FETCH_MAX_ATTEMPTS = 2;

export type PostFetchResult =
  | { ok: true; html: string; bytes: number }
  | { ok: false; reason: string };

/**
 * One post, over the same doctrine every other request in this package follows.
 *
 * The size check reads `content-length` first so an oversized page costs a header
 * exchange rather than half a megabyte; the body length is re-checked after, since
 * a chunked response advertises no length at all.
 */
export async function fetchPostHtml(url: string): Promise<PostFetchResult> {
  try {
    if (!(await isAllowed(url))) return { ok: false, reason: "robots_disallowed" };
    await awaitDomainSlot(url, await getCrawlDelayMs(url));

    const res = await safeFetch(url, {
      headers: { ...realisticHeaders(), "User-Agent": OUTRIVAL_UA },
      timeoutMs: POST_FETCH_TIMEOUT_MS,
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };

    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_POST_BYTES) {
      return { ok: false, reason: "too_large" };
    }
    const html = await res.text();
    const bytes = Buffer.byteLength(html, "utf8");
    if (bytes > MAX_POST_BYTES) return { ok: false, reason: "too_large" };
    return { ok: true, html, bytes };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "fetch_failed" };
  }
}

export interface PostToFetch {
  /** The row this text will enrich. */
  id: string;
  url: string;
}

export interface FetchedPost {
  id: string;
  url: string;
  /** The readable article text, chrome and sidebars stripped. */
  text: string;
}

export interface FetchPostsOptions {
  /** Injected in tests; the real one is `fetchPostHtml`. */
  fetchPost?: (url: string) => Promise<PostFetchResult>;
  /** Posts read in this run. Defaults to POST_FETCH_CAP. */
  cap?: number;
}

/**
 * Read up to `cap` posts, one at a time, and report which ones failed.
 *
 * The cap is enforced on ATTEMPTS, not on successes: twenty refusals is twenty
 * requests to someone else's site, and a run that kept going until it had twenty
 * bodies would be unbounded exactly when the site is least happy to see us.
 *
 * A post whose extracted text is empty counts as failed — a JS-only page returns
 * a shell, and enriching a shell would file topics for a post nobody has read.
 */
export async function fetchPostTexts(
  posts: ReadonlyArray<PostToFetch>,
  options: FetchPostsOptions = {},
): Promise<{ fetched: FetchedPost[]; failed: Array<{ id: string; reason: string }> }> {
  const fetchPost = options.fetchPost ?? fetchPostHtml;
  const cap = options.cap ?? POST_FETCH_CAP;

  const fetched: FetchedPost[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  for (const post of posts.slice(0, cap)) {
    const result = await fetchPost(post.url);
    if (!result.ok) {
      failed.push({ id: post.id, reason: result.reason });
      continue;
    }
    // Defence in depth: the fetcher above already refuses an oversized body, and a
    // test fetcher (or a future caller) that does not must still not reach the model.
    if (result.bytes > MAX_POST_BYTES) {
      failed.push({ id: post.id, reason: "too_large" });
      continue;
    }
    const text = extractArticleText(result.html);
    if (!text.trim()) {
      failed.push({ id: post.id, reason: "empty_article" });
      continue;
    }
    fetched.push({ id: post.id, url: post.url, text });
  }

  return { fetched, failed };
}
