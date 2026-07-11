/**
 * YouTube channel video tracking (content-velocity signal). A competitor's own
 * YouTube channel exposes an OFFICIAL, stable, auth-free RSS feed
 * (https://www.youtube.com/feeds/videos.xml?channel_id=UC…) — each entry is a
 * dated, titled, described video. We resolve the channel from a link on the
 * competitor's homepage, pull that feed, and render a DETERMINISTIC snapshot the
 * generic diff turns into "new video" signals (classify tags content). AI-free,
 * pure regex + the shared feed parser — no transcripts/captions (fragile, ToS
 * grey zone) are ever fetched. Mirrors news/changelog's leaf-parser rule.
 */
import { parseFeed, type FeedItem } from "../feeds/rss";

/** A UC… channel id, always resolvable to the canonical videos feed. */
export function channelFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

// A YouTube channel id is "UC" + 22 url-safe base64 chars. Matching this exact
// shape avoids false positives on unrelated "UC…" substrings on the page.
const CHANNEL_ID_RE = /UC[0-9A-Za-z_-]{22}/;

/**
 * Extract a channel id from a YouTube URL that already carries it
 * (`/channel/UC…`). Handle / custom / user URLs (`/@h`, `/c/x`, `/user/x`) don't
 * embed the id — those resolve via `extractChannelId(channelPageHtml)` after a
 * fetch. Returns null when the URL has no inline id.
 */
export function channelIdFromUrl(url: string): string | null {
  const m = /\/channel\/(UC[0-9A-Za-z_-]{22})/.exec(url);
  return m?.[1] ?? null;
}

/**
 * Pull the channel id out of a fetched YouTube channel page. YouTube embeds it in
 * several stable spots — the canonical link, an `<meta itemprop="identifier">`,
 * the `externalId`/`channelId` JSON keys, and the RSS `<link>` — so we scan for
 * the first `UC…`-shaped token in any of them, falling back to any occurrence on
 * the page. Pure. Null when the page carries none (not a channel page).
 */
export function extractChannelId(html: string): string | null {
  const targeted =
    /rel=["']canonical["'][^>]*\/channel\/(UC[0-9A-Za-z_-]{22})/i.exec(html)?.[1] ??
    /itemprop=["']identifier["'][^>]*content=["'](UC[0-9A-Za-z_-]{22})["']/i.exec(html)?.[1] ??
    /"(?:externalId|channelId)"\s*:\s*"(UC[0-9A-Za-z_-]{22})"/.exec(html)?.[1] ??
    /channel_id=(UC[0-9A-Za-z_-]{22})/.exec(html)?.[1];
  if (targeted) return targeted;
  return CHANNEL_ID_RE.exec(html)?.[0] ?? null;
}

/**
 * Find the competitor's YouTube channel link on its homepage (footer / social
 * row). Accepts channel / handle / custom / user forms; rejects single-video
 * links (`/watch`, `youtu.be/…`, `/shorts/…`) which are not a channel. Prefers a
 * `/channel/UC…` link (its id needs zero extra fetch) over a handle. Absolute
 * URL, or null when the page links no channel. Pure.
 */
export function findYouTubeChannelUrl(html: string, baseUrl: string): string | null {
  const hrefRe = /href=["']([^"']*youtube\.com\/[^"']+)["']/gi;
  let handleMatch: string | null = null;
  for (const m of html.matchAll(hrefRe)) {
    const raw = m[1];
    if (!raw) continue;
    let abs: string;
    try {
      abs = new URL(raw, baseUrl).toString();
    } catch {
      continue;
    }
    const path = new URL(abs).pathname;
    // Single video / shorts / non-channel surfaces are not a channel.
    if (/^\/(watch|shorts|playlist|embed|results|feed)\b/i.test(path)) continue;
    if (/\/channel\/UC[0-9A-Za-z_-]{22}/.test(abs)) return abs; // best: inline id
    if (/^\/(@[^/]+|c\/[^/]+|user\/[^/]+)/i.test(path) && !handleMatch) handleMatch = abs;
  }
  return handleMatch;
}

export interface Video {
  /** Stable identity from the feed (yt:videoId via guid) — drives dedup + sort. */
  id: string;
  title: string;
  /** Canonical watch URL. */
  link: string | null;
  /** ISO publish date when parseable, else null. */
  publishedAt: string | null;
  /** First line of the video description, capped. */
  summary: string | null;
}

function toMs(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Normalize a parsed YouTube feed into videos: dedup by id, drop untitled
 * entries, cap, sort most-recent-first with an id tiebreaker so the cap is
 * deterministic. `parseFeed` already handles the Atom shape YouTube uses.
 */
export function parseChannelFeed(xml: string, limit = 30): Video[] {
  const seen = new Set<string>();
  const out: Video[] = [];
  for (const it of parseFeed(xml)) {
    const title = it.title.trim();
    if (!title) continue;
    const id = it.id || it.link || title;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title, link: it.link, publishedAt: it.publishedAt, summary: it.summary });
  }
  out.sort((a, b) => toMs(b.publishedAt) - toMs(a.publishedAt) || a.id.localeCompare(b.id));
  return out.slice(0, limit);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const MARKER = "outrival-youtube-videos";

/**
 * Render videos into a STABLE snapshot: sorted by id so an unchanged set yields a
 * constant content hash (no phantom diff). Each line names the strategic meaning
 * — "New video: <title>" — because the classifier is AI-driven (no deterministic
 * severity hook for this source), so we shape the diff line it reads. Carries a
 * JSON island for downstream use. Mirrors news.buildNewsDoc.
 */
export function buildYouTubeDoc(
  channelId: string,
  videos: Video[],
): { html: string; text: string } {
  const sorted = [...videos].sort((a, b) => a.id.localeCompare(b.id));
  const lis = sorted
    .map((v) => {
      const date = v.publishedAt?.slice(0, 10);
      const meta = date ? ` [${escapeHtml(date)}]` : "";
      const desc = v.summary ? ` — ${escapeHtml(v.summary.slice(0, 140))}` : "";
      return `<li>New video: ${escapeHtml(v.title)}${meta}${desc}</li>`;
    })
    .join("");
  const json = JSON.stringify({ channelId, videos: sorted }).replace(/</g, "\\u003c");
  const html =
    `<!doctype html><html><body><section data-outrival-youtube>` +
    `<h2>YouTube videos — ${sorted.length}</h2><ul>${lis}</ul></section>` +
    `<script type="application/json" id="${MARKER}">${json}</script></body></html>`;
  const text = sorted
    .map((v) => {
      const date = v.publishedAt ? ` — ${v.publishedAt.slice(0, 10)}` : "";
      return `New video: ${v.title}${date}`;
    })
    .join("\n");
  return { html, text };
}
