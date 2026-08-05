/**
 * What a competitor writes about, as arithmetic (Content Intelligence v2 P4).
 *
 * P2 gave every blog post a set of topics; nothing read them back. These are the
 * functions that turn that column into the two things the Content tab and the
 * `editorial_pivot` signal are made of: what a competitor is publishing about now,
 * and how far that has moved from what they were publishing about last quarter.
 *
 * PURE: no I/O, no DB, no AI. Every number below is counted, not judged — the
 * whole phase adds zero AI calls, and the only model output involved is the topic
 * list P2 already stored and substring-checked.
 *
 * The comparison is a Jensen-Shannon divergence between two topic distributions
 * rather than a diff of the two top-5 lists. A list diff moves when a competitor
 * publishes one extra post; JSD is a distance between SHAPES, so a blog that keeps
 * writing about the same six things in slightly different proportions scores near
 * zero however many posts it publishes, which is the entire point of only alerting
 * on a genuine repositioning.
 */

/** One `content_items` row, as much of it as any function here needs. */
export interface EditorialItem {
  sourceType: string;
  itemType: string | null;
  /** P2 enrichment. Null on an item nobody has read yet. */
  topics: readonly string[] | null;
  /**
   * When the publisher says it went out. Null when the source dates nothing, in
   * which case `firstSeenAt` stands in — the only date we can honestly place it on.
   */
  publishedAt: Date | string | null;
  firstSeenAt: Date | string;
}

/** A half-open interval [start, end). */
export interface DateWindow {
  start: Date;
  end: Date;
}

export interface TopicDistribution {
  /** Items dated inside the window. The denominator every minimum is checked against. */
  posts: number;
  /** Normalised topic → how many of those posts carried it. */
  counts: Record<string, number>;
  /** Sum of `counts` — a post carrying three topics contributes three. */
  total: number;
}

export interface TopicMove {
  topic: string;
  /** Occurrences in the newer window. */
  now: number;
  /** Occurrences in the older window. */
  then: number;
  /** now / total of the newer window. */
  nowShare: number;
  thenShare: number;
  /** nowShare − thenShare. Positive is rising. */
  delta: number;
}

/**
 * The divergence at or above which two 90-day windows are called a pivot.
 *
 * Jensen-Shannon in BASE 2, so the scale is a real [0, 1]: 0 is the same mix of
 * subjects, 1 is two windows with no subject in common. 0.35 is deliberately high
 * — it is roughly the distance you get when a third of a blog's output moves onto
 * subjects it was not writing about at all, and it leaves ordinary quarter-to-
 * quarter drift (a couple of extra posts on an existing theme) far below the line.
 * A pivot that fires twice a year on a competitor who did not reposition is worth
 * less than one missed pivot, because the first kind teaches the reader to ignore
 * the alert.
 */
export const EDITORIAL_PIVOT_DIVERGENCE = 0.35;

/** Enriched posts each window must hold before the shapes are worth comparing. */
export const EDITORIAL_PIVOT_MIN_POSTS = 8;

/** Distinct topics across both windows. Two subjects cannot describe a pivot. */
export const EDITORIAL_PIVOT_MIN_TOPICS = 5;

/** Days each window spans, and therefore how far back the comparison reaches. */
export const EDITORIAL_WINDOW_DAYS = 90;

const DAY_MS = 86_400_000;

/**
 * One topic label, as it is counted and displayed.
 *
 * Lowercased and whitespace-collapsed only. Nothing is stemmed or merged: "ai
 * agent" and "ai agents" stay two topics, because deciding they are one is a
 * judgement, and a wrong merge silently changes a distribution nobody can audit.
 */
export function normalizeTopic(topic: string): string {
  return topic.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The date an item is placed on: what the publisher stated, else when we saw it. */
export function itemDate(item: EditorialItem): Date {
  const raw = item.publishedAt ?? item.firstSeenAt;
  return raw instanceof Date ? raw : new Date(raw);
}

function inWindow(date: Date, window: DateWindow): boolean {
  const t = date.getTime();
  if (Number.isNaN(t)) return false;
  return t >= window.start.getTime() && t < window.end.getTime();
}

/**
 * How a set of items' topics are distributed over one window.
 *
 * The caller passes the items whose topics are worth counting — in practice the
 * blog items that have been READ, since an unread item carries null topics and
 * would otherwise inflate `posts` with posts nobody has opened.
 *
 * A topic repeated inside one post counts once: the unit is "posts about X", not
 * "times X was written down", or a single tag-happy post would carry a window.
 */
export function topicDistribution(
  items: readonly EditorialItem[],
  window: DateWindow,
): TopicDistribution {
  const counts: Record<string, number> = {};
  let posts = 0;
  let total = 0;

  for (const item of items) {
    if (!inWindow(itemDate(item), window)) continue;
    posts++;
    if (!item.topics) continue;
    const seen = new Set<string>();
    for (const raw of item.topics) {
      const topic = normalizeTopic(raw);
      if (!topic || seen.has(topic)) continue;
      seen.add(topic);
      counts[topic] = (counts[topic] ?? 0) + 1;
      total++;
    }
  }

  return { posts, counts, total };
}

/**
 * Jensen-Shannon divergence between two topic distributions, base 2 → [0, 1].
 *
 * Null when either side has no topics at all: two windows cannot be compared when
 * one of them says nothing, and returning 0 there would read as "no change" while
 * returning 1 would read as a total pivot. Neither is true.
 */
export function jensenShannonDivergence(
  a: TopicDistribution,
  b: TopicDistribution,
): number | null {
  if (a.total === 0 || b.total === 0) return null;

  const topics = new Set([...Object.keys(a.counts), ...Object.keys(b.counts)]);
  let divergence = 0;

  for (const topic of topics) {
    const p = (a.counts[topic] ?? 0) / a.total;
    const q = (b.counts[topic] ?? 0) / b.total;
    const m = (p + q) / 2;
    if (m === 0) continue;
    if (p > 0) divergence += 0.5 * p * Math.log2(p / m);
    if (q > 0) divergence += 0.5 * q * Math.log2(q / m);
  }

  // Floating-point noise can push an identical pair a hair either side of 0/1.
  return Math.min(1, Math.max(0, divergence));
}

export interface RisingDecliningOptions {
  /** Topics returned per direction. */
  limit?: number;
  /**
   * Occurrences a topic needs in the window it is moving INTO (rising) or OUT OF
   * (declining) before it can be named. One post's tag is not a trend, and without
   * this the lists fill with one-offs while the real movement sits below them.
   */
  minCount?: number;
}

/**
 * Which topics gained and which lost between two windows.
 *
 * Ranked by SHARE, not by raw count: the two windows rarely hold the same number
 * of posts, so a competitor who published twice as much would show every topic
 * "rising" if counts were compared directly.
 */
export function risingDeclining(
  previous: TopicDistribution,
  current: TopicDistribution,
  options: RisingDecliningOptions = {},
): { rising: TopicMove[]; declining: TopicMove[] } {
  const limit = options.limit ?? 5;
  const minCount = options.minCount ?? 2;

  const topics = new Set([
    ...Object.keys(previous.counts),
    ...Object.keys(current.counts),
  ]);
  const moves: TopicMove[] = [];

  for (const topic of topics) {
    const now = current.counts[topic] ?? 0;
    const then = previous.counts[topic] ?? 0;
    const nowShare = current.total > 0 ? now / current.total : 0;
    const thenShare = previous.total > 0 ? then / previous.total : 0;
    moves.push({ topic, now, then, nowShare, thenShare, delta: nowShare - thenShare });
  }

  const byDelta = (a: TopicMove, b: TopicMove) =>
    b.delta - a.delta || b.now - a.now || a.topic.localeCompare(b.topic);

  return {
    rising: moves
      .filter((m) => m.delta > 0 && m.now >= minCount)
      .sort(byDelta)
      .slice(0, limit),
    declining: moves
      .filter((m) => m.delta < 0 && m.then >= minCount)
      .sort((a, b) => byDelta(b, a))
      .slice(0, limit),
  };
}

export interface CadenceMonth {
  /** "YYYY-MM", UTC. */
  month: string;
  total: number;
  /** source_type → items published that month. Only sources with items appear. */
  bySource: Record<string, number>;
  /**
   * True for the month the `through` date falls in — the one still running.
   *
   * The cadence detector never evaluates it (a month three days old compared
   * against three full ones reports a freeze at every competitor on the 3rd), and
   * the chart draws it open for the same reason. Dropping it instead would leave
   * the reader wondering where this month went.
   */
  partial: boolean;
}

export interface CadenceOptions {
  /** How many months the series spans, ending on the month `through` falls in. */
  months?: number;
  /** Defaults to now. */
  through?: Date;
}

/** "2026-08" for the month a date falls in, UTC. */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-01" → "2025-12". */
function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * Items per month per source, dense and ascending.
 *
 * Months with nothing published are real zeros inside the range, so they are
 * filled rather than skipped: a gap in a cadence chart is the reading.
 */
export function cadenceByMonth(
  items: readonly EditorialItem[],
  options: CadenceOptions = {},
): CadenceMonth[] {
  const months = options.months ?? 12;
  const through = options.through ?? new Date();
  const lastMonth = monthKey(through);

  const keys: string[] = [];
  let cursor = lastMonth;
  for (let i = 0; i < months; i++) {
    keys.unshift(cursor);
    cursor = previousMonth(cursor);
  }
  const index = new Map(keys.map((k, i) => [k, i] as const));

  const series: CadenceMonth[] = keys.map((month) => ({
    month,
    total: 0,
    bySource: {},
    partial: month === lastMonth,
  }));

  for (const item of items) {
    const date = itemDate(item);
    if (Number.isNaN(date.getTime())) continue;
    const at = index.get(monthKey(date));
    if (at === undefined) continue;
    const bucket = series[at];
    if (!bucket) continue;
    bucket.total++;
    bucket.bySource[item.sourceType] = (bucket.bySource[item.sourceType] ?? 0) + 1;
  }

  return series;
}

/** The two windows a pivot compares, ending at `now`. */
export function editorialWindows(now: Date, days = EDITORIAL_WINDOW_DAYS): {
  current: DateWindow;
  previous: DateWindow;
} {
  const end = now.getTime();
  const mid = end - days * DAY_MS;
  const start = mid - days * DAY_MS;
  return {
    current: { start: new Date(mid), end: new Date(end) },
    previous: { start: new Date(start), end: new Date(mid) },
  };
}

export interface PivotOptions {
  now?: Date;
  windowDays?: number;
  threshold?: number;
  minPostsPerWindow?: number;
  minDistinctTopics?: number;
}

export interface EditorialPivot {
  divergence: number;
  current: TopicDistribution;
  previous: TopicDistribution;
  rising: TopicMove[];
  declining: TopicMove[];
  /** Distinct topics across both windows — the breadth the minimum is checked on. */
  distinctTopics: number;
  windows: { current: DateWindow; previous: DateWindow };
}

/**
 * Has this competitor's editorial line moved?
 *
 * Every condition must hold, and each is here to stop a specific false positive:
 *
 *  - EIGHT READ POSTS IN EACH WINDOW. A blog publishing twice a month does not
 *    pivot statistically — its distribution swings on a single post — so below the
 *    floor there is no claim to make, in either direction.
 *  - FIVE DISTINCT TOPICS ACROSS BOTH. A competitor writing about two subjects can
 *    reach a high divergence by swapping one of them, which is a normal week.
 *  - DIVERGENCE AT OR ABOVE A CONSERVATIVE THRESHOLD (see the constant).
 *
 * A consequence worth stating rather than discovering: this cannot fire until a
 * competitor has been tracked for roughly six months, because the posts that
 * predate P2 were baselined and never read, and an unread post carries no topics.
 * That is the design — the alternative is comparing what we know now against a
 * window we never opened, which would report a pivot at every competitor the day
 * the feature ships.
 *
 * The 90-day cooldown is NOT here: it needs the competitor's signal history, which
 * is a database read. The caller owns it.
 */
export function detectEditorialPivot(
  items: readonly EditorialItem[],
  options: PivotOptions = {},
): EditorialPivot | null {
  const now = options.now ?? new Date();
  const threshold = options.threshold ?? EDITORIAL_PIVOT_DIVERGENCE;
  const minPosts = options.minPostsPerWindow ?? EDITORIAL_PIVOT_MIN_POSTS;
  const minTopics = options.minDistinctTopics ?? EDITORIAL_PIVOT_MIN_TOPICS;

  const windows = editorialWindows(now, options.windowDays);
  const current = topicDistribution(items, windows.current);
  const previous = topicDistribution(items, windows.previous);

  if (current.posts < minPosts || previous.posts < minPosts) return null;

  const distinctTopics = new Set([
    ...Object.keys(current.counts),
    ...Object.keys(previous.counts),
  ]).size;
  if (distinctTopics < minTopics) return null;

  const divergence = jensenShannonDivergence(previous, current);
  if (divergence === null || divergence < threshold) return null;

  const { rising, declining } = risingDeclining(previous, current);
  return { divergence, current, previous, rising, declining, distinctTopics, windows };
}

/** The `n` topics a window holds most of, for a fact block or a themes list. */
export function topTopics(
  distribution: TopicDistribution,
  limit = 5,
): Array<{ topic: string; count: number }> {
  return Object.entries(distribution.counts)
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, limit);
}
