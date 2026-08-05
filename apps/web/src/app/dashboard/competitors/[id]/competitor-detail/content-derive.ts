import { ROADMAP_STATUSES, roadmapStatusLabel, type RoadmapStatus } from "@outrival/shared";
import type { ContentItemRow, ContentTimeline } from "@/lib/api";

/**
 * Everything the Content tab DERIVES from its rows, with no React in it.
 *
 * The tab reads one table four different ways (OUT-13) and each reading is a
 * grouping decision — which column an entry belongs in, which section of a docs
 * site a page landed in, which month a feed entry falls under. Those decisions are
 * where a reading goes quietly wrong, so they live here and are unit tested, the
 * same split `compare/derive.ts` uses. PURE: no I/O, no React, no AI.
 */

/** The four sources this tab reads, in stacking order, with their series colour. */
export const SOURCES = [
  { key: "changelog", label: "Changelog", color: "var(--chart-1)" },
  { key: "blog", label: "Blog", color: "var(--chart-2)" },
  { key: "roadmap", label: "Roadmap", color: "var(--chart-3)" },
  { key: "docs", label: "Docs", color: "var(--chart-4)" },
] as const;

/** What "Re-scan now" on this tab has to run: all four, not whichever came first. */
export const SOURCE_KEYS = SOURCES.map((s) => s.key);

export const SOURCE_COLOR: Record<string, string> = Object.fromEntries(
  SOURCES.map((s) => [s.key, s.color]),
);

/**
 * The kinds each source can produce, in the order they are worth reading.
 *
 * This is what makes the kind menu answer "what is it FOR", which was the ticket:
 * beside a row of source pills, an unlabelled "All types" read as a second way to
 * say the same thing. It is not — the pills pick WHERE something was published,
 * this picks WHAT it is — and scoping the menu to the selected source is what makes
 * the difference legible, because "Breaking" is a changelog word and "Case study" a
 * blog one. A source with a single kind (a roadmap entry is only ever a roadmap
 * entry) gets no menu at all.
 */
export const SOURCE_KINDS: Record<string, readonly string[]> = {
  changelog: ["breaking", "deprecation", "security", "feature", "improvement", "fix"],
  blog: [
    "feature_announcement",
    "case_study",
    "thought_leadership",
    "tutorial",
    "seo",
    "company_news",
  ],
  roadmap: ["roadmap_entry"],
  docs: ["doc_page", "doc_endpoint"],
};

/** `published_at ?? first_seen_at` — the date an item is placed on, as the API does. */
export function itemDate(item: ContentItemRow): Date {
  return new Date(item.publishedAt ?? item.firstSeenAt);
}

/** Which reading a source gets. See `content-tab.tsx` for why each one is not a list. */
export type ContentView = "feed" | "board" | "releases" | "pages";

export function viewFor(source: string): ContentView {
  if (source === "roadmap") return "board";
  if (source === "changelog") return "releases";
  if (source === "docs") return "pages";
  return "feed";
}

export interface MonthGroup {
  key: string;
  label: string;
  /** The source dated none of these; the dates shown are ours. */
  undated: boolean;
  items: ContentItemRow[];
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Items in the month they were published in.
 *
 * An item its source never dated gets its own trailing group instead of the month
 * of OUR scrape. A blog listing that prints no dates, or a roadmap portal that
 * states a status and not a publication date, would otherwise have every entry
 * filed under this month — the tab claiming a publication date the publisher never
 * gave. The API sorts those rows last, so the group is one run at the end.
 */
export function groupByMonth(items: readonly ContentItemRow[]): MonthGroup[] {
  const out: MonthGroup[] = [];
  for (const item of items) {
    const at = itemDate(item);
    const undated = item.publishedAt === null;
    const key = undated ? "undated" : `${at.getUTCFullYear()}-${at.getUTCMonth()}`;
    const last = out[out.length - 1];
    if (last?.key === key) last.items.push(item);
    else
      out.push({
        key,
        label: undated ? "Undated" : MONTH_LABEL.format(at),
        undated,
        items: [item],
      });
  }
  return out;
}

export interface BoardColumn {
  status: RoadmapStatus;
  /** Our word for the state. */
  label: string;
  /** The portal's own words for this column, when they are not our word. */
  theirWords: string[];
  items: ContentItemRow[];
}

/**
 * A roadmap as the board it is published as.
 *
 * Columns run in COMMITMENT order — considering, committed, in flight, out the
 * door, refused — which is the order `ROADMAP_STATUSES` is written in and the order
 * the reader cares about. Only the states that hold an entry get a column.
 *
 * Cards rank on VOTES, because on a public portal the vote count is the one number
 * a competitor publishes about its own gaps. An entry with no count sorts below
 * every entry that has one rather than above them, since a portal that publishes no
 * votes has not told us the entry is popular.
 */
export function boardColumns(items: readonly ContentItemRow[]): BoardColumn[] {
  const known = new Set<string>(ROADMAP_STATUSES);
  const byStatus = new Map<RoadmapStatus, ContentItemRow[]>();
  for (const item of items) {
    // An unrecognised column is `other`, never the nearest guess — the same rule
    // the resolver applies, since reading "not planned" as planned would announce a
    // commitment that was a refusal.
    const status = (
      known.has(item.statusNormalized ?? "") ? item.statusNormalized : "other"
    ) as RoadmapStatus;
    const bucket = byStatus.get(status);
    if (bucket) bucket.push(item);
    else byStatus.set(status, [item]);
  }

  return ROADMAP_STATUSES.flatMap((status) => {
    const rows = byStatus.get(status);
    if (!rows) return [];
    const ours = roadmapStatusLabel(status).toLowerCase();
    return [
      {
        status,
        label: roadmapStatusLabel(status),
        // "Up next" is what their customers read, so it is carried alongside our
        // own word — but not when the two are the same word twice.
        theirWords: [
          ...new Set(rows.map((r) => r.status).filter((s): s is string => Boolean(s))),
        ].filter((word) => word.toLowerCase() !== ours),
        items: rows.sort(
          (a, b) =>
            (b.votes ?? -1) - (a.votes ?? -1) ||
            itemDate(b).getTime() - itemDate(a).getTime() ||
            a.title.localeCompare(b.title),
        ),
      },
    ];
  });
}

export interface KindGroup {
  source: string;
  kinds: Array<{ itemType: string | null; count: number }>;
}

/**
 * The kinds on offer, grouped under the source each one belongs to.
 *
 * Scoped to the selected source, because a kind is a source's own word: offering
 * "Case study" under the changelog pill is what made the control read as a second
 * source picker. Each source's own order first, then frequency for anything it does
 * not name, and the unread bucket last — it is a state, not a kind.
 */
export function kindGroups(
  counts: ContentTimeline["typeCounts"],
  source: string,
): KindGroup[] {
  const wanted = counts.filter((c) => source === "all" || c.sourceType === source);
  return SOURCES.map((s) => ({
    source: s.key as string,
    kinds: wanted
      .filter((c) => c.sourceType === s.key)
      .map((c) => ({ itemType: c.itemType, count: c.count }))
      .sort(byKindOrder(s.key)),
  })).filter((g) => g.kinds.length > 0);
}

function byKindOrder(source: string) {
  const order = SOURCE_KINDS[source] ?? [];
  const rank = (itemType: string | null) => {
    if (itemType === null) return Number.MAX_SAFE_INTEGER;
    const at = order.indexOf(itemType);
    return at === -1 ? order.length : at;
  };
  return (
    a: { itemType: string | null; count: number },
    b: { itemType: string | null; count: number },
  ) => rank(a.itemType) - rank(b.itemType) || b.count - a.count;
}

/** Path segments a docs URL spends on housekeeping rather than on a subject. */
const DOCS_HOUSEKEEPING = new Set([
  "docs",
  "doc",
  "documentation",
  "api",
  "reference",
  "en",
  "en-us",
  "latest",
]);

/**
 * The section of their docs an entry landed in.
 *
 * A docs surface publishes pages and endpoints with no dates on them, so grouping
 * by month files every one of them under the month we happened to look. The section
 * is the reading that survives that: it says WHERE the product grew.
 *
 * An endpoint is identified by its path, never by its URL — every operation in a
 * published spec carries the same spec URL, so grouping on that would put a whole
 * API in one bucket.
 */
export function docsArea(item: ContentItemRow): string {
  const path =
    item.itemType === "doc_endpoint"
      ? item.title.replace(/^[a-z]+\s+/i, "")
      : pathnameOf(item.url);
  for (const raw of path.split("/")) {
    const segment = raw.trim().toLowerCase();
    if (!segment) continue;
    if (DOCS_HOUSEKEEPING.has(segment)) continue;
    if (/^v\d+(?:\.\d+)*$/.test(segment)) continue;
    // `{id}` / `:id` name a parameter, not a part of the product.
    if (/^[{:]/.test(segment)) continue;
    // A page extension is not part of the area's name; a dot inside one is.
    return segment.replace(/\.(?:html?|md|mdx|php|aspx)$/, "").replace(/[-_]+/g, " ");
  }
  return "Elsewhere";
}

export function pathnameOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export interface DocsSection {
  area: string;
  rows: ContentItemRow[];
  /** Every row is an endpoint, so the count can say "endpoints" and mean it. */
  endpointsOnly: boolean;
}

/** Their docs, biggest area first — where the product grew, not when we looked. */
export function docsSections(items: readonly ContentItemRow[]): DocsSection[] {
  const by = new Map<string, ContentItemRow[]>();
  for (const item of items) {
    const area = docsArea(item);
    const bucket = by.get(area);
    if (bucket) bucket.push(item);
    else by.set(area, [item]);
  }
  return [...by.entries()]
    .map(([area, rows]) => ({
      area,
      rows,
      endpointsOnly: rows.every((r) => r.itemType === "doc_endpoint"),
    }))
    .sort((a, b) => b.rows.length - a.rows.length || a.area.localeCompare(b.area));
}
