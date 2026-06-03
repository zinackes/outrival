import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { competitors } from "./competitors";
import { products } from "./products";

export const jobPostings = pgTable("job_postings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id").notNull().references(() => competitors.id),
  // patch-28 — self job postings belong to a product (the self-competitor is being
  // removed). Nullable; the pipeline re-anchor step relaxes competitorId and writes
  // productId for self jobs going forward.
  productId: text("product_id").references(() => products.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  department: text("department"),
  location: text("location"),
  url: text("url"),
  isActive: boolean("is_active").notNull().default(true),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
});
