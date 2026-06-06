import { pgTable, text, timestamp, real, pgEnum } from "drizzle-orm/pg-core";
import { competitors } from "./competitors";

export const reviewSourceEnum = pgEnum("review_source", [
  "g2", "capterra", "appstore", "playstore",
  // patch-32 — multi-platform review coverage (+ Reddit mention sentiment).
  "trustpilot", "trustradius", "gartner", "reddit",
]);

export const reviews = pgTable("reviews", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id").notNull().references(() => competitors.id),
  source: reviewSourceEnum("source").notNull(),
  score: real("score"),
  content: text("content"),
  author: text("author"),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
});
