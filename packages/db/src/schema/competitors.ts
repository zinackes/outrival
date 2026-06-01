import { pgTable, text, timestamp, real, jsonb, boolean } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const competitors = pgTable("competitors", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  description: text("description"),
  overlapScore: real("overlap_score"),
  category: text("category"),
  metadata: jsonb("metadata"),
  aiSummary: text("ai_summary"),
  aiSummaryUpdatedAt: timestamp("ai_summary_updated_at"),
  // Pricing taxonomy (patch-11): latest detected state of the pricing page.
  // pricingStatus is one of PricingStatus from @outrival/shared.
  pricingStatus: text("pricing_status"),
  pricingObservedRegion: text("pricing_observed_region"),
  pricingPromotional: boolean("pricing_promotional").notNull().default(false),
  pricingDemoUrl: text("pricing_demo_url"),
  pricingNote: text("pricing_note"),
  // When the user fills pricing in manually, scrapes must not overwrite it.
  pricingManualOverride: boolean("pricing_manual_override").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});
