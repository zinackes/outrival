import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { competitors } from "./competitors";

/**
 * Every rival we have ever seen a competitor name (Positioning Intelligence v2 P2).
 *
 * The sitemap detector has known since sitemap v2 that a `/vs/` page appeared, and
 * it asked exactly one question about it: does the slug name the READER. That case
 * is a critical alert and is untouched. Everything else was discarded — yet
 * `/vs/klue` is this company telling us, in public and on purpose, who it thinks it
 * is losing deals to. Content P2 has been storing the same fact from blog posts
 * (`content_items.competitors_named`) with nowhere to put it.
 *
 * This is that place, and it is the third table of the same family: same
 * conservative normaliser as `known_customers` and `known_integrations`, same
 * insert-only rule, same baseline-first pass. A removal writes NOTHING — comparison
 * pages get consolidated and re-slugged constantly, and "gone from the sitemap we
 * captured last week" is not evidence a company stopped competing.
 *
 * The reader's own product NEVER enters this table. A competitor's `/vs/{us}` page
 * is already a critical from the comparison_page anchor, and filing the reader as a
 * rival of the company attacking them would corrupt every read of the market map.
 */
export const namedCompetitors = pgTable(
  "named_competitors",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** Who is doing the naming. */
    competitorId: text("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    /** The matching key: lowercased, legal form stripped (@outrival/shared — the
     *  same normaliser the customer and integration registries use, so a name read
     *  off `/vs/klue` and off `/klue-alternative` is one target, not two). */
    nameNormalized: text("name_normalized").notNull(),
    /** Prettified from the slug, or as the post wrote it — what a signal renders. */
    displayName: text("display_name").notNull(),
    /**
     * Only when the evidence WAS a domain (`/vs/crayon.co`). Never derived from a
     * name: the cross-reference treats a domain as proof on its own, so a guessed
     * one would let two unrelated companies be reported as the same rival.
     */
    namedDomain: text("named_domain"),
    /**
     * 'vs_page' | 'alternatives_page' | 'blog' | 'docs'.
     *
     * Only the first two can raise a signal. A blog post naming a rival is a
     * mention, not a front: it enters the map so the tab can show it, and it stays
     * silent. Part of the key, so the same target found on a page and then in a
     * post keeps both pieces of evidence.
     */
    source: text("source").notNull(),
    /** The exact page that names them, so a claim can be checked at its source. */
    evidenceUrl: text("evidence_url"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    /** Refreshed on every sighting — how the tab tells a live front from a page
     *  they published once in 2023 and forgot. */
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    /**
     * When a `new_comparison_target` announced this rival. Stamped on EVERY row
     * holding that name, across sources, which is what makes the dedup lifetime:
     * `/vs/crayon` this week and `/alternatives/crayon` next week are one piece of
     * news, and a target already announced is never announced again.
     *
     * Null on a blog or docs mention that never signalled — and deliberately so.
     * A post naming a rival is not them opening a front, so it must not silently
     * consume the announcement the front itself deserves later.
     */
    signalledAt: timestamp("signalled_at"),
  },
  (t) => [
    // The row identity. Scoped by source so a target seen on a page AND in a post
    // keeps both; the SIGNAL deduplicates across sources on its own.
    uniqueIndex("named_competitors_competitor_name_source_uk").on(
      t.competitorId,
      t.nameNormalized,
      t.source,
    ),
    // "Who did they open a front against recently" — the grouped signal and its
    // fact block.
    index("named_competitors_competitor_seen_idx").on(t.competitorId, t.firstSeenAt),
    // "Who names this competitor" — the intra-workspace cross reference, which
    // scans by target rather than by owner.
    index("named_competitors_name_idx").on(t.nameNormalized),
  ],
);

export type NamedCompetitor = InferSelectModel<typeof namedCompetitors>;
export type NewNamedCompetitor = InferInsertModel<typeof namedCompetitors>;
