import { pgTable, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { competitors } from "./competitors";

/**
 * Who a competitor says it sells to (Positioning Intelligence v2 P3).
 *
 * A company publishes its ICP as URLs and nothing reads them as such: `/for/agencies`
 * names a persona, `/industries/fintech` names a vertical, `/use-cases/onboarding`
 * names a job. Those pages are expensive to write and are never written by accident —
 * a new one is a segment somebody decided to go after this quarter. Until now they
 * landed in the sitemap's generic "new pages appeared" lump, where "12 URLs were
 * added" says nothing about which market just opened.
 *
 * Third table of the same family as `known_customers`, `known_integrations` and
 * `named_competitors`: insert-only, baseline-first, and the unique index IS the
 * lifetime dedup. A page that DISAPPEARS writes nothing — marketing sites get
 * re-slugged and consolidated constantly, and "gone from last week's sitemap" is not
 * evidence a company left a market.
 *
 * `kind` is a CLOSED vocabulary of three: 'persona' | 'industry' | 'use_case'. The
 * mapping from a URL section to a kind is a fixed table in
 * `@outrival/scrapers/positioning`, never a guess — a slug we cannot map is dropped
 * rather than filed under a fourth kind nobody defined.
 *
 * `slug` is NOT the same shape across kinds, on purpose:
 *  - persona / use_case — the page's own URL slug ("enterprise", "onboarding").
 *    There is nothing to compare it to, so the honest identity is the URL itself.
 *  - industry — the CANONICAL slug from `@outrival/shared` industry-catalog when the
 *    catalog resolves it, else the slugified label. Same resolver, same output shape
 *    as `case_studies.customer_industry`, which is the whole point: "declared vs
 *    proven" intersects the verticals they publish pages about with the verticals
 *    their case studies actually name, and an intersection only means something when
 *    both sides went through one vocabulary.
 */
export const audiencePages = pgTable(
  "audience_pages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    competitorId: text("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    /** 'persona' | 'industry' | 'use_case' — closed, deterministic from the path. */
    kind: text("kind").notNull(),
    /** The identity. See the note above on why its shape depends on the kind. */
    slug: text("slug").notNull(),
    /** Prettified from the URL slug: "field-service" → "Field Service". */
    displayName: text("display_name").notNull(),
    /** 1 when `slug` is an industry-catalog slug — the only case comparable to a
     *  case study's vertical. int rather than boolean, matching case_studies. */
    isCanonical: integer("is_canonical").notNull().default(0),
    /** The exact page, so a claim about their ICP can be checked at its source. */
    evidenceUrl: text("evidence_url"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  },
  (t) => [
    // The row identity AND the lifetime dedup: an insert that conflicts returns
    // nothing, so "was this page ever announced" is a unique index rather than a
    // second column. Unlike `named_competitors` there is no source dimension — one
    // (kind, slug) is one page however many URL shapes point at it.
    uniqueIndex("audience_pages_competitor_kind_slug_uk").on(t.competitorId, t.kind, t.slug),
    // "What did they open recently" — the grouped signal, its fact block, and the
    // `new` badge the profile endpoint stamps on the last 30 days.
    index("audience_pages_competitor_seen_idx").on(t.competitorId, t.firstSeenAt),
  ],
);

export type AudiencePage = InferSelectModel<typeof audiencePages>;
export type NewAudiencePage = InferInsertModel<typeof audiencePages>;
