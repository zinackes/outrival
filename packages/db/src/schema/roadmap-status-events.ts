import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { competitors } from "./competitors";
import { contentItems } from "./content-items";

/**
 * Every time a roadmap entry MOVED (Content Intelligence v2 P5).
 *
 * `content_items` holds a portal entry's CURRENT status, because that is what the
 * next capture upserts. But the questions this feature exists to answer are about
 * movement: did the request their customers vote up the most just become planned
 * work, and how much have they actually delivered this quarter. Neither can be read
 * off a table that only remembers where things stand now.
 *
 * Two properties make the row trustworthy:
 *
 *  - BOTH SIDES ARE KEPT, RAW AND NORMALISED. The normalised pair is what a query
 *    groups on; the raw labels are what the reader recognises, because a portal
 *    names its own columns ("Up next", "Shipping soon") and paraphrasing them into
 *    our vocabulary would put words in the competitor's mouth.
 *  - THE FIRST PASS IS A BASELINE. A portal read for the first time hands us thirty
 *    entries, some of which have been "planned" for two years. Writing those as
 *    transitions would announce thirty roadmap moves the day a competitor is added,
 *    so they are written with `isBaseline = 1` and can never raise a signal — the
 *    same rule the customers registry follows in P3.
 */
export const roadmapStatusEvents = pgTable(
  "roadmap_status_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    contentItemId: text("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    competitorId: text("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    /** Normalised (@outrival/shared roadmap-status). Null on a baseline row: the
     *  entry did not come from anywhere, we simply had not read the portal yet. */
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    /** The portal's own words, on each side. Null where `fromStatus` is. */
    fromRaw: text("from_raw"),
    toRaw: text("to_raw").notNull(),
    /** When WE saw the move. A portal states a status, never a date, so this is
     *  the only timestamp that exists — and it is labelled as ours everywhere. */
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    /** 1 = written by the first read of this portal; can never signal. int rather
     *  than boolean, matching case_studies.is_canonical_industry. */
    isBaseline: integer("is_baseline").notNull().default(0),
    /**
     * When this move raised `top_request_planned`, if it did. The same discipline
     * as `posting_facts.signalled_at`: portal statuses flap (a request bounced
     * between "Planned" and "Under review" twice in a fortnight is one piece of
     * news), and this column is what a 30-day cooldown per ENTRY is read off.
     * Without it the cooldown would have to be inferred from the signals table,
     * which stores no entry id.
     */
    signalledAt: timestamp("signalled_at"),
  },
  (t) => [
    // "What has this competitor delivered lately" — the delivered-rate aggregate.
    index("roadmap_status_events_competitor_occurred_idx").on(t.competitorId, t.occurredAt),
    // The 30-day dedup reads one entry's own recent moves.
    index("roadmap_status_events_item_occurred_idx").on(t.contentItemId, t.occurredAt),
  ],
);

export type RoadmapStatusEvent = InferSelectModel<typeof roadmapStatusEvents>;
export type NewRoadmapStatusEvent = InferInsertModel<typeof roadmapStatusEvents>;
