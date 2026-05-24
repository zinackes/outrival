import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { competitors } from "./competitors";

export const jobPostings = pgTable("job_postings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id").notNull().references(() => competitors.id),
  title: text("title").notNull(),
  department: text("department"),
  location: text("location"),
  url: text("url"),
  isActive: boolean("is_active").notNull().default(true),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
});
