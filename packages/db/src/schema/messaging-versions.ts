import { pgTable, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { competitors } from "./competitors";

/**
 * How a competitor has described itself, over time (Positioning Intelligence v2 P1).
 *
 * The data was already captured and never assembled: `parseHomepageStructure`
 * (patch-16) has read the hero headline, subheadline and CTAs off every homepage
 * capture since it shipped, and the only thing that ever looked at them across
 * time was an endpoint that re-derived the whole timeline lazily, on every open,
 * by scanning the last 400 snapshots. That read is bounded by captures scanned
 * rather than by versions found, so a competitor that never rewrites its homepage
 * costs the most to answer, and nothing else in the product could ask the question
 * at all.
 *
 * So the timeline is materialised: one row per DISTINCT wording, stamped with the
 * capture where that wording FIRST appeared. Two things follow from that.
 *
 * `captured_at` is a first-seen date, not a last-seen one — two consecutive rows
 * read as "they changed this on that date". Storing the last capture that carried
 * a wording instead would date every version to the day we last saw it, and the
 * pair would read as a rewrite that never happened.
 *
 * A row is only opened when the WORDS move: case, punctuation and symbols are
 * normalised away (`messagingFingerprint`, @outrival/shared), because a stray
 * period being fixed is not a repositioning. The unique key on
 * (competitor, captured_at) is what makes the one-shot R2 backfill idempotent —
 * the same capture chain always plans the same rows at the same timestamps, so a
 * second run conflicts on every one of them and writes nothing.
 *
 * `value_props` are carried but are NOT part of the version key: they come from
 * section headings, which are renamed constantly on pages whose hero is untouched.
 * They say what the page listed when this wording first appeared, which is what
 * the positioning history's added/dropped panel reads.
 */
export const messagingVersions = pgTable(
  "messaging_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    competitorId: text("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    /** The hero headline. Never null in practice — a capture without one is not
     *  a company that stopped saying anything, so it opens no version at all. */
    h1: text("h1"),
    subheadline: text("subheadline"),
    /** The primary CTA's own words ("Start free trial" → "Book a demo" is a
     *  go-to-market move, and it is invisible in the headline). */
    primaryCta: text("primary_cta"),
    valueProps: jsonb("value_props").$type<string[]>().notNull().default([]),
    /** When this wording was FIRST captured. */
    capturedAt: timestamp("captured_at").notNull(),
    /** The R2 key of that capture, so a version can be read back at its source. */
    snapshotKey: text("snapshot_key"),
  },
  (t) => [
    // Both the idempotency key of the backfill and the index the timeline is read
    // on (newest-first per competitor) — a second btree on the same columns would
    // serve nothing this one does not.
    uniqueIndex("messaging_versions_competitor_captured_uk").on(t.competitorId, t.capturedAt),
  ],
);

export type MessagingVersion = InferSelectModel<typeof messagingVersions>;
export type NewMessagingVersion = InferInsertModel<typeof messagingVersions>;
