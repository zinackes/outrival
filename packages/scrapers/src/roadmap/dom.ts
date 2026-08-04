import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { ROADMAP_STATUS_WORDS, statusesLookLikeRoadmap } from "./generic";
import type { RoadmapEntry, RoadmapParse } from "./types";

/**
 * Portal adapter for roadmaps that exist only as MARKUP.
 *
 * `generic.ts` covers every portal that server-renders its state as JSON. A second
 * family does not: UserJot ships a board with no `<script>` on the page at all, and
 * FeatureOS renders its columns in the browser, so even after a render pass the
 * entries live in the DOM and nowhere else. For those two shapes there is no payload
 * to read — the page IS the payload.
 *
 * Reading a roadmap out of markup is far easier to get WRONG than reading one out of
 * JSON: every listing on the web is a repeated block with a link and a heading, so a
 * blog index, a docs sidebar and a pricing table all look like this from a distance.
 * The bar below is therefore the whole module, and it is the same bar `generic.ts`
 * applies, moved from object keys onto DOM slots:
 *
 *   - REPEATED PERMALINKS. Entries are found by their links, grouped by path shape
 *     (`/p/*`, `/board/p/*`), which is what a portal always has and a marketing page
 *     never does. The canonical link is also the entry's identity, so the snapshot
 *     sorts on something the vendor owns.
 *   - A SLOT, NOT AN ELEMENT. Title, status and votes are read from a `tag.class`
 *     slot that appears on nearly EVERY card, never by hunting each card separately.
 *     A slot that only some cards carry is not a field, it is a coincidence.
 *   - A STATUS THAT BEHAVES LIKE AN ENUM, drawn from roadmap vocabulary. This is the
 *     one check that separates a roadmap from every other repeated listing: nothing
 *     else on the web puts "Planned" or "In Progress" on every row.
 *
 * Below that bar it returns `unparsable`, which the scraper reports as "no portal
 * here" — never as a guess.
 *
 * ## Column layouts
 *
 * A board laid out as columns prints the status ONCE, as the column's header, and
 * not on the cards. When no in-card slot qualifies, the status therefore falls back
 * to the nearest label printed OUTSIDE any card before it, which is exactly that
 * header. That reading is looser, so it carries an extra condition: at least two
 * distinct statuses, because a page with one heading above a list of links is a list
 * of links.
 *
 * PURE: no I/O, no DB, no AI.
 */

const MIN_ENTRIES = 3;
const MAX_ENTRIES = 500;
const MIN_TITLE_CHARS = 3;
const MAX_TITLE_CHARS = 300;
const MAX_STATUS_CHARS = 40;
const MAX_DISTINCT_STATUSES = 8;

/** A field is a slot present on nearly every card. Below this it is a coincidence. */
const MIN_SLOT_PRESENCE = 0.8;
/** Titles are essentially unique; a slot that repeats is a category, not a title. */
const MIN_TITLE_DISTINCT_RATIO = 0.8;
/** Anchors read off one page, before grouping. Deeper than any real board. */
const MAX_ANCHORS = 2000;
/**
 * How far up from its link a card may reach. The climb stops on its own at the first
 * ancestor holding a sibling card; this only bounds a page whose markup nests a link
 * a dozen levels deep inside its own row.
 */
const MAX_CLIMB = 6;

/** Marks the anchors of the group being evaluated, so the climb can count them. */
const CARD_MARK = "data-orv-card";

/** Subtrees that carry no reader-visible text. `svg > title` is a tooltip, not a label. */
const NON_TEXT = new Set(["script", "style", "noscript", "template", "svg", "head"]);

/** "Apr 10th", "3/14", "Nov 21st 2025", "2 days ago" — a date is never a title. */
const DATE_RE =
  /^(?:\d{1,2}\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{0,4}\s*(?:st|nd|rd|th)?$|^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$|\bago$/i;

/** "2.6K", "1,234", "18" — what a vote counter prints. */
const COUNT_RE = /^([\d,.]+)\s*([km])?$/i;

/** An ancestor that says a number is a vote count rather than a comment count. */
const VOTE_LABEL_RE = /\bvote|\bupvote/i;

interface Leaf {
  /** `tag|class` — stable within a page, which is all this needs to be. */
  slot: string;
  tag: string;
  text: string;
  /** Whether an ancestor names this a vote control. */
  voteish: boolean;
}

/** `2.6K` → 2600. Null when the text is not a count at all. */
export function parseCount(raw: string): number | null {
  const m = COUNT_RE.exec(raw.trim());
  if (!m) return null;
  const digits = (m[1] ?? "").replace(/,/g, "");
  if (digits === "" || digits === ".") return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const scaled = unit === "k" ? n * 1_000 : unit === "m" ? n * 1_000_000 : n;
  return Math.max(0, Math.round(scaled));
}

/** Query and fragment stripped, trailing slash dropped — one row per entry. */
function canonical(raw: string, base: string): string | null {
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.hash = "";
  u.search = "";
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }
  return u.toString();
}

/** `/board/p/unified-inbox` → `/board/p/*`. Null when the path is too shallow to be an entry. */
function pathShape(url: string): string | null {
  let segments: string[];
  try {
    segments = new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
  // One segment is a section (`/roadmap`, `/pricing`), never an entry permalink.
  if (segments.length < 2) return null;
  return `${segments.slice(0, -1).join("/")}/*`;
}

function normalize(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Every text-bearing leaf of `card`, with the slot it sits in. First wins per slot. */
function leavesOf($: cheerio.CheerioAPI, card: Element): Map<string, Leaf> {
  const out = new Map<string, Leaf>();
  const visit = (node: AnyNode) => {
    if (node.type !== "tag") return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (NON_TEXT.has(tag)) return;
    const children = el.children.filter((c): c is Element => c.type === "tag");
    if (children.length > 0) {
      for (const child of children) visit(child);
      return;
    }
    const text = normalize($(el).text());
    if (!text) return;
    const slot = `${tag}|${normalize(el.attribs.class ?? "")}`;
    if (out.has(slot)) return;
    const labelled = $(el).closest("[aria-label], [title]");
    const label = `${labelled.attr("aria-label") ?? ""} ${labelled.attr("title") ?? ""}`;
    out.set(slot, { slot, tag, text, voteish: VOTE_LABEL_RE.test(label) });
  };
  visit(card);
  return out;
}

/**
 * The card an entry link belongs to: the highest ancestor that still holds only THIS
 * link. One rung further up is the container of every sibling card, which is where
 * the climb stops on its own.
 */
function cardOf($: cheerio.CheerioAPI, anchor: Element): Element {
  let card = anchor;
  for (let i = 0; i < MAX_CLIMB; i++) {
    const parent = $(card).parent();
    const el = parent.get(0);
    if (!el || el.type !== "tag") break;
    const tag = (el as Element).tagName.toLowerCase();
    if (tag === "body" || tag === "html") break;
    if (parent.find(`[${CARD_MARK}]`).length !== 1) break;
    card = el as Element;
  }
  return card;
}

/** Slots carried by at least {@link MIN_SLOT_PRESENCE} of the cards. */
function commonSlots(cards: Map<string, Leaf>[]): string[] {
  const counts = new Map<string, number>();
  for (const card of cards) {
    for (const slot of card.keys()) counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  const floor = cards.length * MIN_SLOT_PRESENCE;
  return [...counts.entries()].filter(([, n]) => n >= floor).map(([slot]) => slot);
}

function valuesOf(cards: Map<string, Leaf>[], slot: string): (Leaf | undefined)[] {
  return cards.map((c) => c.get(slot));
}

/**
 * Which slot holds the entry titles: the one whose values are nearly all distinct and
 * read like a phrase. A heading tag wins a tie, because a portal that marks its titles
 * up as headings has told us which slot it means.
 */
function pickTitleSlot(cards: Map<string, Leaf>[], slots: string[]): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const slot of slots) {
    const leaves = valuesOf(cards, slot).filter((l): l is Leaf => l !== undefined);
    if (leaves.length < MIN_ENTRIES) continue;
    if (
      leaves.some(
        (l) =>
          l.text.length < MIN_TITLE_CHARS ||
          l.text.length > MAX_TITLE_CHARS ||
          DATE_RE.test(l.text) ||
          parseCount(l.text) !== null,
      )
    ) {
      continue;
    }
    const ratio = new Set(leaves.map((l) => l.text.toLowerCase())).size / leaves.length;
    if (ratio < MIN_TITLE_DISTINCT_RATIO) continue;
    const heading = /^h[1-6]$/.test(leaves[0]?.tag ?? "") ? 0.5 : 0;
    const score = ratio + heading;
    if (score > bestScore) {
      bestScore = score;
      best = slot;
    }
  }
  return best;
}

/**
 * Which slot holds the statuses: a short label, few distinct values across the board,
 * and at least one of them a word only a roadmap uses.
 */
function pickStatusSlot(cards: Map<string, Leaf>[], slots: string[], skip: string | null): string | null {
  let best: string | null = null;
  let bestHits = 0;
  let bestDistinct = Infinity;
  for (const slot of slots) {
    if (slot === skip) continue;
    const leaves = valuesOf(cards, slot).filter((l): l is Leaf => l !== undefined);
    if (leaves.length < MIN_ENTRIES) continue;
    if (leaves.some((l) => l.text.length > MAX_STATUS_CHARS || parseCount(l.text) !== null)) continue;
    const values = leaves.map((l) => l.text.toLowerCase());
    const distinct = new Set(values);
    if (distinct.size > MAX_DISTINCT_STATUSES) continue;
    const hits = values.filter((v) => ROADMAP_STATUS_WORDS.some((w) => v.includes(w))).length;
    if (hits === 0) continue;
    if (hits > bestHits || (hits === bestHits && distinct.size < bestDistinct)) {
      bestHits = hits;
      bestDistinct = distinct.size;
      best = slot;
    }
  }
  return best;
}

/** Which slot holds the vote counts: numbers, under something that says "vote". */
function pickVoteSlot(cards: Map<string, Leaf>[], slots: string[]): string | null {
  for (const slot of slots) {
    const leaves = valuesOf(cards, slot).filter((l): l is Leaf => l !== undefined);
    if (leaves.length < MIN_ENTRIES) continue;
    if (!leaves.every((l) => l.voteish && parseCount(l.text) !== null)) continue;
    return slot;
  }
  return null;
}

/**
 * The label printed before each card, outside every card — a column header in a board
 * laid out as columns. Numbers and dates are skipped: a lane prints its count next to
 * its name, and that count is not the name.
 */
function precedingLabels($: cheerio.CheerioAPI, cards: Element[]): Map<Element, string> {
  const cardSet = new Set<Element>(cards);
  const out = new Map<Element, string>();
  let label = "";

  const visit = (node: AnyNode, insideCard: boolean) => {
    if (node.type === "text") {
      if (insideCard) return;
      const text = normalize(node.data ?? "");
      if (!text || text.length > MAX_STATUS_CHARS) return;
      if (parseCount(text) !== null || DATE_RE.test(text)) return;
      label = text;
      return;
    }
    if (node.type === "root") {
      for (const child of (node as unknown as { children: AnyNode[] }).children) {
        visit(child, insideCard);
      }
      return;
    }
    if (node.type !== "tag") return;
    const el = node as Element;
    if (NON_TEXT.has(el.tagName.toLowerCase())) return;
    const isCard = cardSet.has(el);
    if (isCard) out.set(el, label);
    for (const child of el.children) visit(child, insideCard || isCard);
  };

  visit($.root().get(0) as AnyNode, false);
  return out;
}

interface Group {
  anchors: Element[];
  urls: string[];
}

/** Entry links grouped by path shape, largest group first. */
function anchorGroups($: cheerio.CheerioAPI, base: string): Group[] {
  let host: string;
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    return [];
  }

  const groups = new Map<string, Group>();
  const seen = new Set<string>();
  const anchors = $("a[href]").toArray().slice(0, MAX_ANCHORS);
  for (const el of anchors) {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) continue;
    const url = canonical(href, base);
    if (!url) continue;
    try {
      if (new URL(url).hostname.toLowerCase() !== host) continue;
    } catch {
      continue;
    }
    // One row per entry: a board links the same post from its title and its avatar.
    if (seen.has(url)) continue;
    const shape = pathShape(url);
    if (!shape) continue;
    seen.add(url);
    const group = groups.get(shape) ?? { anchors: [], urls: [] };
    group.anchors.push(el as Element);
    group.urls.push(url);
    groups.set(shape, group);
  }

  return [...groups.values()]
    .filter((g) => g.anchors.length >= MIN_ENTRIES)
    .sort((a, b) => b.anchors.length - a.anchors.length);
}

/** Read one group of entry links as a portal, or null when it does not clear the bar. */
function readGroup($: cheerio.CheerioAPI, group: Group): RoadmapEntry[] | null {
  for (const el of group.anchors) $(el).attr(CARD_MARK, "1");
  try {
    const cards = group.anchors.map((a) => cardOf($, a));
    const leaves = cards.map((c) => leavesOf($, c));
    const slots = commonSlots(leaves);

    const titleSlot = pickTitleSlot(leaves, slots);
    if (!titleSlot) return null;

    const statusSlot = pickStatusSlot(leaves, slots, titleSlot);
    const voteSlot = pickVoteSlot(leaves, slots);
    // A column board prints its status once, above the cards. Read outside them only
    // when nothing inside them qualified — the in-card label is always the better fact.
    const headers = statusSlot ? null : precedingLabels($, cards);

    const entries: RoadmapEntry[] = [];
    for (const [i, card] of cards.entries()) {
      const url = group.urls[i];
      const leaf = leaves[i];
      if (!url || !leaf) return null;
      const title = leaf.get(titleSlot)?.text;
      const status = statusSlot ? leaf.get(statusSlot)?.text : headers?.get(card);
      if (!title || !status) continue;
      const votes = voteSlot ? parseCount(leaf.get(voteSlot)?.text ?? "") : null;
      entries.push({ id: url, title, status: status.toLowerCase(), votes: votes ?? 0, url });
      if (entries.length >= MAX_ENTRIES) break;
    }

    if (entries.length < MIN_ENTRIES) return null;
    const statuses = new Set(entries.map((e) => e.status));
    if (statuses.size > MAX_DISTINCT_STATUSES) return null;
    if (!statusesLookLikeRoadmap(statuses)) return null;
    // A header-derived status is one heading applied to everything under it, so a
    // single value proves nothing: a page titled "Roadmap" above a list of links
    // would otherwise read as a board where every entry is planned.
    if (!statusSlot && statuses.size < 2) return null;
    return entries;
  } finally {
    for (const el of group.anchors) $(el).removeAttr(CARD_MARK);
  }
}

/**
 * Read a roadmap out of a page that renders its entries as markup. `unparsable` when
 * nothing on the page clears the bar, which the scraper reports as "no portal here".
 */
export function parseDomPortal(html: string, url: string): RoadmapParse {
  const $ = cheerio.load(html);
  for (const group of anchorGroups($, url)) {
    const entries = readGroup($, group);
    if (entries) {
      // `truncated` stays false for the same reason it does in the generic adapter: a
      // vendor we do not know cannot tell us it paginated.
      return { ok: true, portal: { vendor: "dom", url, entries, truncated: false } };
    }
  }
  return { ok: false, reason: "unparsable" };
}
