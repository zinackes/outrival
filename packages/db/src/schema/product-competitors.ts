import {
  pgTable,
  text,
  timestamp,
  boolean,
  real,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { products } from "./products";
import { competitors } from "./competitors";

// patch-28 — junction linking a competitor (org-level) to a product. By default a
// competitor is shared across the org's products (isSpecific=false, "relevant to
// this product but tracked org-wide"). isSpecific=true marks it as specific to one
// product. Signal tagging (signals.productIds) and per-product feeds derive from
// these rows; relevanceScore (patch-17) is the contextual relevance of this
// competitor FOR this product.
export const productCompetitors = pgTable(
  "product_competitors",
  {
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    competitorId: text("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    isSpecific: boolean("is_specific").notNull().default(false),
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
