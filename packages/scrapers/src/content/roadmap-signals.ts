import { isCommittedRoadmapStatus, isOpenRoadmapStatus, type RoadmapStatus } from "@outrival/shared";

/**
 * Deciding when a roadmap move is worth telling someone about (Content
 * Intelligence v2 P5).
 *
 * A portal publishes two things at once: what a competitor has committed to build,
 * and how many of their own customers asked for it. Separately, each is noise — a
 * status column moves every week, and a vote count is a number on a page. Together
 * they are the only public statement of the form "our customers' single loudest
 * request is now on our roadmap", which is the moment a rival closes a gap that
 * their market has been telling them about out loud.
 *
 * So the bar is a RANK plus a FLOOR, and both are load-bearing:
 *
 *  - RANK. Only the top few open requests count. Every portal has a hundred entries
 *    moving through statuses continuously; without a rank this fires weekly on
 *    whatever the team groomed that morning.
 *  - FLOOR. A portal where the most-wanted item has six votes has not told us what
 *    its market wants, it has told us nobody is using its portal. Ranking alone
 *    would happily crown that six-vote entry #1.
 *
 * PURE: no I/O, no DB, no AI.
 */

/** Rank a request must hold, among the portal's OPEN entries, to be worth a signal. */
export const TOP_REQUEST_MAX_RANK = 3;
/**
 * Votes the request itself must carry. A floor on the ENTRY, not on the portal:
 * being the loudest request on a silent portal is not evidence of demand.
 */
export const TOP_REQUEST_MIN_VOTES = 10;
/** At #1 AND this many votes, the move is high — that is their flagship request. */
export const TOP_REQUEST_HIGH_VOTES = 50;
/**
 * Days one entry stays quiet after firing. Statuses flap: a request bounced between
 * "Planned" and "Under review" twice in a fortnight is one piece of news, and
 * without this the same entry would alert on every bounce.
 */
export const TOP_REQUEST_COOLDOWN_DAYS = 30;

/** One entry of the portal as it stands after this capture. */
export interface RoadmapEntryState {
  itemId: string;
  title: string;
  url: string | null;
  /** Exact count as published. Null when the portal publishes none — such an entry
   *  can never be ranked, and is therefore never a top request. */
  votes: number | null;
  status: RoadmapStatus;
}

/** One status move this capture recorded. */
export interface RoadmapMove {
  itemId: string;
  /** Normalised. Null only on a baseline row, which never reaches this module. */
  fromStatus: RoadmapStatus | null;
  toStatus: RoadmapStatus;
  /** The portal's own words, which is what the signal quotes. */
  fromRaw: string | null;
  toRaw: string;
}

/** A move that cleared the bar, with everything the signal text needs. */
export interface TopRequestMove {
  itemId: string;
  title: string;
  url: string | null;
  votes: number;
  /** 1-based, among the portal's OPEN entries ordered by votes. */
  rank: number;
  fromRaw: string | null;
  toRaw: string;
  severity: "high" | "medium";
}

export interface TopRequestPlan {
  /** The move the signal is about: the highest-ranked one that qualified. */
  primary: TopRequestMove;
  /** Other qualifying moves in the SAME capture, named in the body rather than
   *  raised separately — a grooming session that promotes two top requests at once
   *  is one piece of news, told once. */
  alsoMoved: TopRequestMove[];
}

/**
 * Rank the portal's open requests by votes, highest first.
 *
 * Ties break on the entry id, so the ordering is stable across captures: a rank
 * that reshuffles under equal votes would let the same entry drift in and out of
 * the top three and fire again on the way back in.
 *
 * Entries with no published count are excluded rather than treated as zero — the
 * question is which request has the most support, and an unmeasured entry has no
 * position in that ordering.
 */
export function rankOpenRequests(entries: ReadonlyArray<RoadmapEntryState>): RoadmapEntryState[] {
  return entries
    .filter((e) => isOpenRoadmapStatus(e.status) && e.votes != null)
    .sort((a, b) => (b.votes as number) - (a.votes as number) || a.itemId.localeCompare(b.itemId));
}

/**
 * Which of this capture's moves, if any, is worth a `top_request_planned`.
 *
 * `cooledDown` holds the entry ids that fired inside the cooldown window; they are
 * filtered here rather than at the call site so the rule sits next to the rank and
 * the floor it belongs with.
 */
export function planTopRequestSignal(args: {
  moves: ReadonlyArray<RoadmapMove>;
  entries: ReadonlyArray<RoadmapEntryState>;
  cooledDown: ReadonlySet<string>;
}): TopRequestPlan | null {
  const ranked = rankOpenRequests(args.entries);
  const rankById = new Map(ranked.map((e, i) => [e.itemId, i + 1]));
  const byId = new Map(args.entries.map((e) => [e.itemId, e]));

  const qualified: TopRequestMove[] = [];
  for (const move of args.moves) {
    // Only a COMMITMENT counts. A request moving to "under review" is a portal
    // being tidied; a request moving to planned or in progress is work taken on.
    if (!isCommittedRoadmapStatus(move.toStatus)) continue;
    if (args.cooledDown.has(move.itemId)) continue;
    const entry = byId.get(move.itemId);
    if (!entry || entry.votes == null) continue;
    if (entry.votes < TOP_REQUEST_MIN_VOTES) continue;
    const rank = rankById.get(move.itemId);
    if (!rank || rank > TOP_REQUEST_MAX_RANK) continue;

    qualified.push({
      itemId: move.itemId,
      title: entry.title,
      url: entry.url,
      votes: entry.votes,
      rank,
      fromRaw: move.fromRaw,
      toRaw: move.toRaw,
      // The one band that reads as "drop what you are doing": their most-wanted
      // request, with real support behind it, now committed.
      severity: rank === 1 && entry.votes >= TOP_REQUEST_HIGH_VOTES ? "high" : "medium",
    });
  }

  if (qualified.length === 0) return null;
  qualified.sort((a, b) => a.rank - b.rank || b.votes - a.votes);
  const [primary, ...alsoMoved] = qualified as [TopRequestMove, ...TopRequestMove[]];
  return { primary, alsoMoved };
}
