import { pgTable, text, timestamp, real, pgEnum, index } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { products } from "./products";

export const candidateStatusEnum = pgEnum("candidate_status", [
  "new",
  "dismissed",
  "added",
]);

// Where a candidate came from: the weekly Exa detection job ("detection",
// the default for pre-existing rows) or saved from the onboarding discovery
// step ("onboarding").
export const candidateSourceEnum = pgEnum("candidate_source", [
  "detection",
  "onboarding",
]);

export const competitorCandidates = pgTable(
  "competitor_candidates",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // patch-28 multi-SKU — the product this candidate was discovered for (its
    // self-profile drove the Exa search). Nullable for legacy rows (backfilled to the
    // primary product). The discovery feed filters by it so each product has its own
    // review queue; a tracked candidate links to this product, not always the primary.
    productId: text("product_id").references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title"),
    overlapScore: real("overlap_score"),
    reason: text("reason"),
    status: candidateStatusEnum("status").notNull().default("new"),
    source: candidateSourceEnum("source").notNull().default("detection"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  },
  (t) => [
    index("competitor_candidates_product_idx").on(t.productId, t.status),
    // Org-level discovery feed + monthly discovery quota + eraseOrg cascade (the
    // product index leads with productId, so orgId isn't covered on its own).
    index("competitor_candidates_org_idx").on(t.orgId, t.status),
  ],
);
