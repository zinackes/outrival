import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { competitors } from "./competitors";
import { contentItems } from "./content-items";

/**
 * The customer stories a competitor publishes about itself (Content Intelligence
 * v2 P3).
 *
 * Homepage logos were already tracked (patch-17), which answers "who is on their
 * wall" and nothing else. A case study answers the questions a sales team actually
 * asks: WHICH customer, in WHICH market, doing WHAT with the product, and what
 * number they are willing to put in print. That is the difference between knowing a
 * rival won a logo and knowing they are winning in your vertical.
 *
 * `customerIndustry` is a slug from `@outrival/shared` industry-catalog, or the
 * slugified label when the catalog does not know it — `isCanonicalIndustry` says
 * which. Only a canonical slug can raise the signal to HIGH, because only a
 * canonical slug is comparable to the reader's own market; a free-text slug is that
 * page's wording and matches nothing but itself.
 *
 * `customerName` is null on an anonymised story ("a leading European bank"). Those
 * rows are the point of a vertical count and are deliberately NOT a customer win:
 * a name we do not have is not a name we can report.
 */
export const caseStudies = pgTable(
  "case_studies",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /**
     * The published item this was read off. Null when the page was reached from a
     * sitemap or a customers index rather than from a feed entry — a case-study
     * page is often not in any feed, and refusing to store it because of that
     * would drop exactly the pages this feature exists for.
     */
    contentItemId: text("content_item_id").references(() => contentItems.id, {
      onDelete: "set null",
    }),
    competitorId: text("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    /** The page itself, and the identity of this row: one story per URL. */
    url: text("url").notNull(),
    title: text("title"),
    /** VERBATIM from the page, substring-verified code-side. Null = anonymised. */
    customerName: text("customer_name"),
    /** Canonical slug, or the slugified label the page used. */
    customerIndustry: text("customer_industry"),
    /** The page's own words for the market ("regional insurance broker"). */
    customerIndustryLabel: text("customer_industry_label"),
    /** 1 when `customerIndustry` is a catalog slug — the only case that can raise
     *  severity. int rather than boolean, matching plan_entitlements. */
    isCanonicalIndustry: integer("is_canonical_industry").notNull().default(0),
    /** One line on what the customer used it for. Model-written, never quoted. */
    useCase: text("use_case"),
    /**
     * The numbers the story claims ("cut churn 32%", "3x faster onboarding"), each
     * VERBATIM and substring-verified before insert. A metric we cannot find in the
     * page is dropped rather than stored — the whole value of a claimed metric is
     * that the competitor is the one who wrote it.
     */
    metricsClaimed: text("metrics_claimed").array(),
    confidence: doublePrecision("confidence"),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    // One row per story. Re-reading a customers index that still links the same
    // page inserts nothing, which is what makes the discovery loop idempotent.
    uniqueIndex("case_studies_competitor_url_uk").on(t.competitorId, t.url),
    // The battle-card section reads "this competitor's stories, newest first".
    index("case_studies_competitor_recorded_idx").on(t.competitorId, t.recordedAt),
  ],
);

/**
 * Every customer we have ever seen a competitor claim, and where we saw it.
 *
 * This table is what makes `customer_win` a fact rather than a guess. Without it,
 * "a new customer" would mean "a name that was not on the page we captured last
 * week", so a logo wall that rotates, a case study republished under a new URL, or
 * a customers page that paginates would each announce the same win again. With it,
 * the question is the one the reader is actually asking — HAVE WE EVER SEEN THIS
 * CUSTOMER BEFORE — and the answer is a unique index.
 *
 * Insert-only by design. A customer that DISAPPEARS is never recorded as anything:
 * logos rotate, carousels swap, a page redesign drops half the wall. A churn signal
 * built on that would be wrong most of the time, so the locked decision is that
 * removals produce nothing at all.
 */
export const knownCustomers = pgTable(
  "known_customers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    competitorId: text("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    /** The matching key: lowercased, legal-form stripped (@outrival/shared). */
    nameNormalized: text("name_normalized").notNull(),
    /** As the page wrote it — what the signal and the battle card render. */
    displayName: text("display_name").notNull(),
    /** 'case_study' | 'customers_page' — where we first saw them. */
    source: text("source").notNull(),
    /** The page that named them, so a win can be read at its source. */
    evidenceUrl: text("evidence_url"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  },
  (t) => [
    // The dedup that makes a win fire once, for good.
    uniqueIndex("known_customers_competitor_name_uk").on(t.competitorId, t.nameNormalized),
    // "Who did they win recently" (signal fact block, battle card wins list).
    index("known_customers_competitor_seen_idx").on(t.competitorId, t.firstSeenAt),
  ],
);

export type CaseStudy = InferSelectModel<typeof caseStudies>;
export type NewCaseStudy = InferInsertModel<typeof caseStudies>;
export type KnownCustomer = InferSelectModel<typeof knownCustomers>;
export type NewKnownCustomer = InferInsertModel<typeof knownCustomers>;
