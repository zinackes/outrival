/**
 * Social-proof tracking helpers — patch-17. Customer logos and testimonials
 * appearing / disappearing on a homepage are competitive signals (a new marquee
 * logo, a churned reference). PURE: no DB, no cheerio — string logic only, so the
 * worker drives it on stored structures and it's unit-testable. Exposed as the
 * `@outrival/scrapers/social-proof` subpath.
 */

export interface TestimonialItem {
  /** Stable hash of the normalized quote, for matching across scrapes. */
  hash: string;
  /** Quote text (truncated), kept for the change card. */
  quote: string;
  author: string | null;
}

/**
 * A captured customer logo. `name` is the `<img alt>` brand name (drives the
 * named add/remove diff) and `src` is the resolved absolute image URL (renders
 * the real logo). Either can be null; a captured entry has at least one.
 */
export interface CustomerLogo {
  name: string | null;
  src: string | null;
}

/** Legacy snapshots stored a single string (alt || src); new ones store objects. */
type LogoEntry = string | CustomerLogo;

/** Brand name of a logo entry, tolerating the legacy string shape. */
function logoEntryName(e: LogoEntry): string {
  return typeof e === "string" ? e : (e.name ?? e.src ?? "");
}

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

// Looks like a URL / filename (logo with no alt text) rather than a brand name —
// matching those across CDN paths is noise, so they're dropped from the named diff.
function looksLikeAsset(s: string): boolean {
  return /^https?:\/\//i.test(s) || /\.(png|jpe?g|svg|webp|gif)(\?|$)/i.test(s) || s.includes("/");
}

/** Brand name normalized for matching, or null if it's an asset path / too short. */
export function normalizeLogo(raw: string): string | null {
  const t = norm(raw);
  if (!t || t.length < 2 || t.length > 60 || looksLikeAsset(t)) return null;
  return t.toLowerCase();
}

/**
 * Named customer logos added / removed between two snapshots. Matches by
 * normalized brand name; returns display names (original casing of the current
 * side for adds, of the prior side for removals). Asset-only logos are ignored.
 */
export function diffLogos(
  prev: readonly LogoEntry[],
  curr: readonly LogoEntry[],
): { added: string[]; removed: string[] } {
  const prevMap = new Map<string, string>();
  for (const e of prev) {
    const l = logoEntryName(e);
    const n = normalizeLogo(l);
    if (n && !prevMap.has(n)) prevMap.set(n, norm(l));
  }
  const currMap = new Map<string, string>();
  for (const e of curr) {
    const l = logoEntryName(e);
    const n = normalizeLogo(l);
    if (n && !currMap.has(n)) currMap.set(n, norm(l));
  }
  const added: string[] = [];
  const removed: string[] = [];
  for (const [n, display] of currMap) if (!prevMap.has(n)) added.push(display);
  for (const [n, display] of prevMap) if (!currMap.has(n)) removed.push(display);
  return { added, removed };
}

/**
 * Stable, dependency-free hash of a testimonial quote (FNV-1a over the first 120
 * normalized chars). A quote with the same opening hashes the same across scrapes;
 * a different quote almost never collides.
 */
export function hashTestimonial(quote: string): string {
  const key = norm(quote).toLowerCase().slice(0, 120);
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Testimonials added / removed, using TWO stability windows so a rotating
 * carousel can NEVER fire (hard constraint patch-17). Given the last `2 * window`
 * snapshots newest-first ([current, prev, …]):
 *  - recent window = the `window` newest scrapes (incl. current)
 *  - prior window  = the `window` scrapes before that
 *  - added:   present in EVERY recent scrape AND absent in EVERY prior scrape
 *             — it became, and stayed, present.
 *  - removed: absent in EVERY recent scrape AND present in EVERY prior scrape
 *             — it was stably there and is now stably gone.
 * A carousel item is never present (nor absent) for `window` consecutive scrapes,
 * so it satisfies neither condition. As the windows slide each transition fires
 * about once. Fewer than `2 * window` sets ⇒ nothing (not enough history).
 */
export function diffTestimonialsStable(
  setsNewestFirst: TestimonialItem[][],
  window = 3,
): { added: TestimonialItem[]; removed: TestimonialItem[] } {
  if (setsNewestFirst.length < window * 2) return { added: [], removed: [] };

  const hashSets = setsNewestFirst.map((s) => new Set(s.map((t) => t.hash)));
  const recent = hashSets.slice(0, window);
  const prior = hashSets.slice(window, window * 2);
  const inAllRecent = (h: string): boolean => recent.every((s) => s.has(h));
  const inNoRecent = (h: string): boolean => recent.every((s) => !s.has(h));
  const inAllPrior = (h: string): boolean => prior.every((s) => s.has(h));
  const inNoPrior = (h: string): boolean => prior.every((s) => !s.has(h));

  const added: TestimonialItem[] = [];
  const removed: TestimonialItem[] = [];

  // Adds sourced from the current set; removals from the most recent prior set.
  const seenAdded = new Set<string>();
  for (const t of setsNewestFirst[0] ?? []) {
    if (seenAdded.has(t.hash)) continue;
    if (inAllRecent(t.hash) && inNoPrior(t.hash)) {
      seenAdded.add(t.hash);
      added.push(t);
    }
  }
  const seenRemoved = new Set<string>();
  for (const t of setsNewestFirst[window] ?? []) {
    if (seenRemoved.has(t.hash)) continue;
    if (inNoRecent(t.hash) && inAllPrior(t.hash)) {
      seenRemoved.add(t.hash);
      removed.push(t);
    }
  }
  return { added, removed };
}
