import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { competitors } from "./competitors";

/**
 * What a competitor published, as ROWS rather than as a diff (Content Intelligence
 * v2 P1).
 *
 * Changelog, blog, docs and roadmap were captured well and understood not at all:
 * each scrape produced a snapshot, the snapshot produced a diff, and the diff was
 * handed to a classifier that wrote a paragraph. Nothing accumulated. There was no
 * table to ask "how many releases did they ship last month", no way to tell a
 * breaking change from a copy tweak, and the `product_hint` corroboration the
 * hiring miner promises ("a recent changelog / docs move") had nothing to query.
 *
 * This table is that missing memory. It is written IN ADDITION to the existing
 * snapshot → diff → classify path, which stays the floor: nothing here can make a
 * capture stop producing the change it produces today.
 *
 * `externalId` is what makes the write idempotent — the feed's own guid, or the
 * portal's own entry id. Both are stable across captures by the vendor's own
 * contract, so re-reading the same feed twice re-inserts nothing, and an entry
 * whose title is edited stays ONE row rather than becoming a second publication.
 */
export const contentItems = pgTable(
  "content_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    competitorId: text("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    /** 'blog' | 'changelog' | 'docs' | 'roadmap' — the source that published it. */
    sourceType: text("source_type").notNull(),
    /**
     * The publisher's OWN id for this item: an RSS/Atom guid, a portal entry id.
     * Never derived from the title or the date, either of which an editor can
     * change without publishing anything new.
     */
    externalId: text("external_id").notNull(),
    url: text("url"),
    title: text("title").notNull(),
    /**
     * When the publisher says it went out. Null when the source states no date
     * (roadmap portals don't publish one) — never back-filled with the capture
     * time, which would make the shipping cadence a picture of our scrape
     * schedule rather than of theirs.
     */
    publishedAt: timestamp("published_at"),
    /** When WE first saw it. The only date a signal's attribution window can use. */
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    /**
     * changelog: feature | improvement | fix | breaking | deprecation | security
     * roadmap: roadmap_entry · docs: doc_page · blog: (P2)
     *
     * Null means "not typed yet". The loud types (breaking / deprecation /
     * security / fix) are assigned by a deterministic keyword pass, so no signal
     * this table emits depends on a model's judgement; the model only ever
     * separates feature from improvement, which emits nothing.
     */
    itemType: text("item_type"),
    /** Roadmap only: the portal's own status label, lowercased. */
    status: text("status"),
    /**
     * Roadmap only (P5): `status` resolved onto our own vocabulary —
     * under_review | planned | in_progress | delivered | closed | other.
     *
     * The raw label stays in `status` and is what the reader is shown, because a
     * portal's columns are named by its own team ("Up next", "Shipping soon",
     * "En cours") and those words are the ones their customers read. This column
     * is what a QUERY can group on: without it "how many did they deliver last
     * quarter" would mean matching free text, and every portal spells delivery
     * differently. `other` is the honest answer for a label we do not recognise —
     * never a guess, since a wrong read of "declined" as "planned" would announce
     * a shipping commitment that was actually a refusal.
     */
    statusNormalized: text("status_normalized"),
    /**
     * Roadmap only (P5): the EXACT vote count the portal published.
     *
     * The diff-bearing snapshot body carries a BAND (see roadmap/snapshot.ts) and
     * that stays true — raw counts drift on every row every week, so a raw listing
     * would diff end to end on every capture. But a band cannot rank, and "their
     * single most requested feature just moved to planned" is a fact about a
     * ranking. So the exact number lives here, off the diff path, where it is read
     * for ordering and display and can never fabricate a change.
     */
    votes: integer("votes"),
    topics: text("topics").array(),
    products: text("products").array(),
    personas: text("personas").array(),
    competitorsNamed: text("competitors_named").array(),
    /** Model-written, one line. Never quoted as evidence — see `evidenceSnippet`. */
    summary: text("summary"),
    /**
     * Verbatim from the item's own text, substring-verified code-side before
     * insert, exactly like `posting_facts.evidence_snippet`. Null when the source
     * gave us no body to quote (a title-only feed entry), which is a fact about
     * the feed and not something to paper over.
     */
    evidenceSnippet: text("evidence_snippet"),
    confidence: doublePrecision("confidence"),
    /**
     * "This item has been through the typer, whatever it returned." Without it a
     * barren item is indistinguishable from an unread one and goes back to the
     * model on every run — the same discipline `job_postings.facts_mined_at` uses.
     */
    enrichedAt: timestamp("enriched_at"),
    /**
     * Blog only (P2): how many times we have gone and tried to FETCH this post.
     *
     * Reading a blog post means requesting someone else's page, and some of those
     * pages cannot be read — a paywall, a login, a body that only exists after
     * JavaScript runs. Without a counter those posts are indistinguishable from
     * ones we have not reached yet, so every run would re-request all of them,
     * forever. Two attempts, then we stop asking: that a post is unreadable is a
     * fact about the post, and continuing to knock is us not listening.
     *
     * Distinct from `enrichedAt`, which means "a model has seen this". A post can
     * be out of the fetch queue on attempts and still have been read by nobody.
     */
    enrichAttempts: integer("enrich_attempts").notNull().default(0),
  },
  (t) => [
    // The identity of an item. Scoped by source as well as competitor: a blog and
    // a changelog on the same domain can hand out the same guid.
    uniqueIndex("content_items_competitor_source_external_idx").on(
      t.competitorId,
      t.sourceType,
      t.externalId,
    ),
    // The shipping-cadence aggregate reads "this competitor's changelog items by
    // month", and the Content tab (P4) reads the same series newest-first.
    index("content_items_competitor_source_published_idx").on(
      t.competitorId,
      t.sourceType,
      t.publishedAt,
    ),
    // A signal's fact block reads the items first seen inside its window.
    index("content_items_competitor_first_seen_idx").on(t.competitorId, t.firstSeenAt),
  ],
);
