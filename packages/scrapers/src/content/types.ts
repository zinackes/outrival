/**
 * What a published content item looks like before it reaches the database
 * (Content Intelligence v2 P1). PURE: no I/O, no DB, no AI.
 */

/**
 * The types a changelog entry can carry. The first four are assigned by the
 * deterministic keyword pass and are the ONLY ones any P1 signal reads, so no
 * alert in this feature depends on a model's judgement. `feature` and
 * `improvement` are what the batched typer separates, and they emit nothing.
 */
export const CHANGELOG_ITEM_TYPES = [
  "breaking",
  "deprecation",
  "security",
  "fix",
  "feature",
  "improvement",
] as const;
export type ChangelogItemType = (typeof CHANGELOG_ITEM_TYPES)[number];

/** The types that carry a signal on their own, loudest first. */
export const SIGNALLING_ITEM_TYPES = ["breaking", "deprecation"] as const;
export type SignallingItemType = (typeof SIGNALLING_ITEM_TYPES)[number];

/** One item as a source published it, before we know anything else about it. */
export interface ContentItemInput {
  /** The publisher's own stable id (feed guid, portal entry id). */
  externalId: string;
  title: string;
  url: string | null;
  /** ISO string, or null when the source states no date. Never invented. */
  publishedAt: string | null;
  /** The body the source gave us, if any — what a snippet may be quoted from. */
  body: string | null;
  /** Roadmap only: the portal's own status label, lowercased. */
  status: string | null;
  /** Set at parse time when the source itself determines the type (roadmap, docs). */
  itemType: string | null;
}

export function isChangelogItemType(value: string): value is ChangelogItemType {
  return (CHANGELOG_ITEM_TYPES as readonly string[]).includes(value);
}
