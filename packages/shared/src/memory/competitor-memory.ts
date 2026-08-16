/**
 * Accumulated competitor memory — the one narration function (OUT-172).
 *
 * Outrival stores every change it ever finds, but only ever reads back the last
 * seven days: the weekly brief restarts from zero each Monday and the competitor
 * page shows atomised movement ("+3 in 30 days") without ever telling the story.
 * What a user knows about a competitor therefore evaporates instead of compounding.
 *
 * This turns the append-only signal history into "what you know now": per
 * competitor, the dated facts we have watched change over the WHOLE tracking
 * period, oldest first. It is deterministic — no AI call, no new prose — so the
 * same rows produce the same story in the email, in the in-app reader and on the
 * competitor page. Both surfaces call this; neither re-derives it, which is what
 * keeps the push read and the pull read from drifting apart.
 *
 * Only the human before/after pair is narrated. That pair is written by the
 * classifier as a plain-language restatement of the diff and is deliberately KEPT
 * by the grounding layer even when a signal's generated prose is withheld
 * (packages/ai/src/grounding/abstention.ts), so it is the one field safe to replay
 * months later. Callers still filter out anything the faithfulness gate blocked —
 * see the query in apps/workers/src/core/generate-weekly-digest.ts.
 */

/** One accumulated signal, as a caller's query hands it over. */
export interface MemorySignalRow {
  competitorId: string;
  competitor: string;
  category: string;
  /** Plain-language state before the change. Null on a first capture. */
  before: string | null;
  /** Plain-language state after it. Rows without one carry no fact and are dropped. */
  after: string | null;
  at: Date | string;
  /** The signal this fact came from, so a surface can link back to the evidence. */
  signalId?: string | null;
}

/** One dated fact in a competitor's story. */
export interface MemoryFact {
  category: string;
  before: string | null;
  after: string;
  /** ISO instant, so a consumer can re-derive its own label. */
  at: string;
  /** "3 weeks ago", frozen when the story is built — a brief reads as of its date. */
  ago: string;
  /** Set when the caller asked for it; the email ignores it, the page links on it. */
  signalId?: string | null;
}

/** What we have accumulated on one competitor. */
export interface CompetitorStory {
  competitorId: string;
  competitor: string;
  /** ISO instant of the FIRST accumulated fact — how far back the memory goes. */
  since: string;
  /** "Mar 3, 2026" — formatted here so email and web print the same date. */
  sinceLabel: string;
  /** Every accumulated fact, including the ones the cap left out of `facts`. */
  total: number;
  /** Chronological, oldest first, capped to the most recent `maxFacts`. */
  facts: MemoryFact[];
}

export interface CompetitorMemory {
  stories: CompetitorStory[];
  /** Eligible competitors beyond the cap, for a "+N more" line. */
  omitted: number;
}

/** One change is not a trajectory: below this a competitor has no story to tell. */
export const MEMORY_MIN_FACTS = 2;
/** A brief is read in two minutes — three stories is what fits before it becomes a log. */
export const MEMORY_MAX_COMPETITORS = 3;
/** A competitor watched for a year has dozens of facts; the recent ones carry the trajectory. */
export const MEMORY_MAX_FACTS = 5;
/**
 * Ceiling on the signal history one memory block is built from. An org watching
 * twenty competitors for a year sits far under it; past it the OLDEST facts are the
 * ones dropped, so the rendered trajectory stays correct and only `since` reads later
 * than the true first capture. The reverse (capping the recent end) would silently
 * narrate a stale story, which is worse than a shortened one.
 *
 * Lives next to the builder because three surfaces read the same block — the weekly
 * brief, the daily brief and the in-progress preview of the next one — and a
 * per-caller copy would let them disagree on how far back the memory goes.
 */
export const MEMORY_HISTORY_CAP = 2000;

const DAY_MS = 86_400_000;

/**
 * How long ago something happened, in the coarsest unit that still says it.
 *
 * Deterministic and locale-free: the same instant renders identically in the email
 * HTML, in the server render and in the browser, which a live `Intl.RelativeTimeFormat`
 * against the reader's clock would not.
 */
export function relativeAge(at: Date | string, now: Date = new Date()): string {
  const then = at instanceof Date ? at : new Date(at);
  const days = Math.floor((now.getTime() - then.getTime()) / DAY_MS);
  if (!Number.isFinite(days) || days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.max(1, Math.round(days / 7));
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }
  if (days < 365) {
    const months = Math.max(1, Math.round(days / 30));
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  const years = Math.max(1, Math.floor(days / 365));
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function dateLabel(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** "Watched since Mar 3, 2026 · 7 changes" — the same line on every surface. */
export function storySummary(story: CompetitorStory): string {
  return `Watched since ${story.sinceLabel} · ${story.total} change${
    story.total === 1 ? "" : "s"
  }`;
}

/** One fact as a sentence, for the Markdown export and for assistive text. */
export function memoryFactText(fact: MemoryFact): string {
  const what = fact.before ? `${fact.before} → ${fact.after}` : fact.after;
  return `${fact.category.replace(/_/g, " ")}: ${what} (${fact.ago})`;
}

/**
 * Group accumulated signals into per-competitor stories.
 *
 * Ranking is by how much we have on a competitor, not by recency: the point of the
 * section is depth of knowledge, and a competitor with one change last night is
 * exactly the one the rest of the brief already covers.
 */
export function buildCompetitorMemory(
  rows: MemorySignalRow[],
  opts: {
    now?: Date;
    minFacts?: number;
    maxCompetitors?: number;
    maxFacts?: number;
  } = {},
): CompetitorMemory {
  const now = opts.now ?? new Date();
  const minFacts = opts.minFacts ?? MEMORY_MIN_FACTS;
  const maxCompetitors = opts.maxCompetitors ?? MEMORY_MAX_COMPETITORS;
  const maxFacts = opts.maxFacts ?? MEMORY_MAX_FACTS;

  const grouped = new Map<string, { competitor: string; facts: MemoryFact[] }>();

  for (const row of rows) {
    const after = row.after?.trim();
    // No "after" means no state to report; such a row is a change we detected but
    // could not restate, and inventing one is exactly what this section must not do.
    if (!after) continue;
    const at = row.at instanceof Date ? row.at : new Date(row.at);
    const time = at.getTime();
    if (!Number.isFinite(time)) continue;

    const iso = at.toISOString();
    const entry = grouped.get(row.competitorId) ?? { competitor: row.competitor, facts: [] };
    entry.facts.push({
      category: row.category,
      before: row.before?.trim() || null,
      after,
      at: iso,
      ago: relativeAge(at, now),
      signalId: row.signalId ?? null,
    });
    grouped.set(row.competitorId, entry);
  }

  const eligible = [...grouped.entries()]
    .map(([competitorId, entry]) => {
      const facts = entry.facts.sort((a, b) => a.at.localeCompare(b.at));
      return { competitorId, competitor: entry.competitor, facts };
    })
    .filter((e) => e.facts.length >= minFacts)
    .sort(
      (a, b) =>
        b.facts.length - a.facts.length ||
        // Same depth: the one that moved most recently leads.
        (b.facts.at(-1)?.at ?? "").localeCompare(a.facts.at(-1)?.at ?? "") ||
        a.competitor.localeCompare(b.competitor),
    );

  const stories = eligible.slice(0, maxCompetitors).map((e) => {
    const since = e.facts[0]?.at ?? "";
    return {
      competitorId: e.competitorId,
      competitor: e.competitor,
      since,
      sinceLabel: dateLabel(since),
      total: e.facts.length,
      // The cap keeps the most RECENT facts, but `since` still points at the first
      // one: the story stays honest about how far back the watch goes.
      facts: e.facts.slice(-maxFacts),
    };
  });

  return { stories, omitted: Math.max(0, eligible.length - stories.length) };
}
