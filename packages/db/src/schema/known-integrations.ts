import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { competitors } from "./competitors";

/**
 * Every third-party integration we have ever seen a competitor list (Content
 * Intelligence v2 P5).
 *
 * `partnerships` has been a signal category since the taxonomy v2 rewrite and
 * nothing fed it directly: a competitor shipping a Salesforce connector only
 * surfaced if a blog post happened to mention it. An /integrations catalog is where
 * that fact is published first, and it is published as a list — which is exactly
 * the shape `known_customers` already solved.
 *
 * So this is that table's twin, deliberately, down to the conservative
 * normalisation: same key (competitor, normalised name), same insert-only rule, same
 * baseline-first pass. A catalog lists every integration the company has ever
 * shipped, so the first read must record and stay silent; and a REMOVAL writes
 * nothing at all, because catalogs paginate and get re-organised, so "gone from the
 * page we captured last week" is not evidence a partnership ended.
 */
export const knownIntegrations = pgTable(
  "known_integrations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    competitorId: text("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    /** The matching key: lowercased, legal form stripped (@outrival/shared —
     *  the same normaliser the customer registry uses, so "Slack" read off a URL
     *  slug and "Slack, Inc." read off a tile are one integration, not two). */
    nameNormalized: text("name_normalized").notNull(),
    /** As the page wrote it (or the slug title-cased) — what a signal renders. */
    displayName: text("display_name").notNull(),
    /** The catalog page or the integration's own page, so a claim can be checked. */
    evidenceUrl: text("evidence_url"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  },
  (t) => [
    // The dedup that makes an integration announce itself once, for good.
    uniqueIndex("known_integrations_competitor_name_uk").on(t.competitorId, t.nameNormalized),
    // "What did they add recently" — the grouped signal and its fact block.
    index("known_integrations_competitor_seen_idx").on(t.competitorId, t.firstSeenAt),
  ],
);

export type KnownIntegration = InferSelectModel<typeof knownIntegrations>;
export type NewKnownIntegration = InferInsertModel<typeof knownIntegrations>;
