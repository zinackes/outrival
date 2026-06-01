import { pgTable, text, timestamp, boolean, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { competitors } from "./competitors";

export const sourceTypeEnum = pgEnum("source_type", [
  "homepage", "pricing", "blog", "changelog", "jobs",
  "g2_reviews", "capterra_reviews", "appstore_reviews",
  "linkedin", "twitter", "github_repo",
]);

export const frequencyEnum = pgEnum("frequency", ["realtime", "daily", "weekly"]);

export const monitors = pgTable("monitors", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id").notNull().references(() => competitors.id, { onDelete: "cascade" }),
  sourceType: sourceTypeEnum("source_type").notNull(),
  frequency: frequencyEnum("frequency").notNull().default("daily"),
  config: jsonb("config"),
  isActive: boolean("is_active").notNull().default(true),
  requiresProxy: boolean("requires_proxy").notNull().default(false),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  lastChangedAt: timestamp("last_changed_at"),
  scrapeStartedAt: timestamp("scrape_started_at"),
  lastFailedAt: timestamp("last_failed_at"),
  lastError: text("last_error"),
  aiSummary: text("ai_summary"),
  aiSummaryUpdatedAt: timestamp("ai_summary_updated_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
