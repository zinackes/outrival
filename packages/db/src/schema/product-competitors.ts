import { pgTable, text, timestamp, real, primaryKey, index } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { products } from "./products";
import { competitors } from "./competitors";

// patch-28 — junction linking a competitor (org-level) to a product. The row IS the
// membership: a competitor is relevant to exactly the products it has a row for, and
// linking it to several is how "shared across SKUs" is expressed. The old
// `is_specific` flag was dropped (2026-07-29) — every link was written shared, so it
// labelled the common case wrong and answered a question the rows already answer.
// Signal tagging (signals.productIds) and per-product feeds derive from these rows;
// relevanceScore (patch-17) is the contextual relevance of this competitor FOR this
// product.
export const productCompetitors = pgTable(
  "product_competitors",
  {
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    competitorId: text("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    relevanceScore: real("relevance_score"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.competitorId] }),
    // The PK already indexes product-leading lookups; this covers the reverse
    // direction (tagSignalProducts queries every product for a given competitor).
    index("product_competitors_competitor_idx").on(t.competitorId),
  ],
);

export type ProductCompetitor = InferSelectModel<typeof productCompetitors>;
export type NewProductCompetitor = InferInsertModel<typeof productCompetitors>;
