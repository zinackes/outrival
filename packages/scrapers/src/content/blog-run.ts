import type { ContentItemInput } from "./types";

/**
 * What a blog capture is allowed to DO (Content Intelligence v2 P2).
 *
 * The rule this encodes is the one that keeps the feature honest, so it lives in
 * code that can be tested rather than in the shape of a job's control flow:
 *
 * A blog index shows everything the company has ever published. The first time we
 * capture one, every post on it is "new to us" and none of it is new to the world.
 * Reading them would mean twenty fetches and, worse, a `critical` alert saying a
 * competitor just named the user in an article from two years ago. So the first
 * capture WRITES the rows — that memory is the point of the table — and reads
 * nothing. Everything that appears after it is genuinely a publication.
 *
 * PURE: no I/O, no DB, no AI.
 */

/** Rows written by the very first capture: a blog's recent past, not its archive. */
export const BASELINE_ITEMS = 30;

export type BlogRunPlan =
  | { mode: "baseline"; seed: ContentItemInput[] }
  | { mode: "read"; items: ContentItemInput[] };

/** Newest first, undated last — a listing with no dates keeps its own order. */
export function newestFirst(items: ReadonlyArray<ContentItemInput>): ContentItemInput[] {
  return [...items].sort((a, b) => {
    if (a.publishedAt && b.publishedAt) return b.publishedAt.localeCompare(a.publishedAt);
    if (a.publishedAt) return -1;
    if (b.publishedAt) return 1;
    return 0;
  });
}

/**
 * Decide the run. `heldRows` is how many blog items we already store for this
 * competitor — zero means we have never seen this blog, whatever the index shows.
 */
export function planBlogRun(args: {
  heldRows: number;
  items: ReadonlyArray<ContentItemInput>;
  baselineCap?: number;
}): BlogRunPlan {
  if (args.heldRows > 0) return { mode: "read", items: [...args.items] };
  return {
    mode: "baseline",
    seed: newestFirst(args.items).slice(0, args.baselineCap ?? BASELINE_ITEMS),
  };
}
