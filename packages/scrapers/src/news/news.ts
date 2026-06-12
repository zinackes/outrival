/**
 * News / funding mention tracking (company-level events). Unlike the product
 * surface (homepage/pricing/jobs), this watches what the *world* says about a
 * competitor — funding rounds, M&A, leadership moves, press. We query Google
 * News' public RSS by brand, keep recent brand-matching items, and render a
 * deterministic snapshot the generic lexical diff turns into "new event" signals
 * (classify-change tags funding/product/hiring downstream). Pure parsing here;
 * the fetch lives in the scraper. AI-free, mirroring the leaf-parser rule.
 */
import { parseFeed, type FeedItem } from "../feeds/rss";

export interface NewsItem {
  /** Stable identity from the feed (guid first) — drives dedup + sort. */
  id: string;
  title: string;
  link: string | null;
  /** ISO date when parseable, else null. */
  publishedAt: string | null;
  /** Publisher, split off Google News' " - <Publisher>" headline suffix. */
  source: string | null;
}

/**
 * Google News RSS search for a brand. `when:{N}d` bounds the feed to the recent
 * window server-side; we re-filter client-side for determinism. Quoted term for
 * precision (reduces homonym noise).
 */
export function googleNewsRssUrl(brand: string, withinDays = 30): string {
  const q = encodeURIComponent(`"${brand}" when:${withinDays}d`);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

/** Google News appends " - <Publisher>" to each headline; split it out (only a
 * short trailing segment counts, so real titles containing " - " stay intact). */
function splitSource(rawTitle: string): { title: string; source: string | null } {
  const title = rawTitle.trim();
  const i = title.lastIndexOf(" - ");
  if (i > 0 && title.length - i <= 60) {
    return { title: title.slice(0, i).trim(), source: title.slice(i + 3).trim() || null };
  }
  return { title, source: null };
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function toMs(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

export interface FilterOptions {
  /** Drop items older than this many days. */
  withinDays?: number;
  /** Reference "now" (ms) — injected so filtering is pure/testable. */
  now?: number;
  /** Max items kept (most recent first). */
  limit?: number;
}

/**
 * From raw feed items: keep those that actually mention the brand (Google News
 * is fuzzy), dedup by id, drop items outside the window, cap. The brand match
 * guards against homonyms; the date guard keeps the snapshot bounded. Sorted
 * most-recent-first with an id tiebreaker so the cap is deterministic.
 */
export function filterNewsItems(
  items: FeedItem[],
  brand: string,
  opts: FilterOptions = {},
): NewsItem[] {
  const { withinDays = 30, now = Date.now(), limit = 30 } = opts;
  const cutoff = now - withinDays * 86_400_000;
  const needle = normalize(brand);
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    const { title, source } = splitSource(it.title);
    const hay = normalize(`${title} ${it.summary ?? ""}`);
    if (needle && !hay.includes(needle)) continue; // brand must appear (homonym guard)
    const ms = toMs(it.publishedAt);
    if (ms && ms < cutoff) continue; // outside the window
    const id = it.id || it.link || title;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title, link: it.link, publishedAt: it.publishedAt, source });
  }
  out.sort((a, b) => toMs(b.publishedAt) - toMs(a.publishedAt) || a.id.localeCompare(b.id));
  return out.slice(0, limit);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const MARKER = "outrival-news-items";

/**
 * Render items into a STABLE snapshot: sorted by id so an unchanged result set
 * yields a constant content hash (no phantom diff). The lexical diff then
 * surfaces genuinely new headlines. Carries a JSON island for downstream use.
 */
export function buildNewsDoc(brand: string, items: NewsItem[]): { html: string; text: string } {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const lis = sorted
    .map((n) => {
      const meta = [n.source, n.publishedAt?.slice(0, 10)].filter(Boolean).join(" · ");
      const m = meta ? ` [${escapeHtml(meta)}]` : "";
      return `<li>${escapeHtml(n.title)}${m}</li>`;
    })
    .join("");
  const json = JSON.stringify({ brand, items: sorted }).replace(/</g, "\\u003c");
  const html =
    `<!doctype html><html><body><section data-outrival-news><h2>News mentions of ${escapeHtml(brand)} (${sorted.length})</h2><ul>${lis}</ul></section>` +
    `<script type="application/json" id="${MARKER}">${json}</script></body></html>`;
  const text = sorted
    .map(
      (n) =>
        `${n.title}${n.source ? ` (${n.source})` : ""}${n.publishedAt ? ` — ${n.publishedAt.slice(0, 10)}` : ""}`,
    )
    .join("\n");
  return { html, text };
}

/** Parse a Google News RSS payload into normalized, brand-filtered news items. */
export function parseNewsFeed(xml: string, brand: string, opts?: FilterOptions): NewsItem[] {
  return filterNewsItems(parseFeed(xml), brand, opts);
}
