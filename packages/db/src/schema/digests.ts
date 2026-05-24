import { pgTable, text, timestamp, jsonb, date } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const digests = pgTable("digests", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull().references(() => organizations.id),
  weekStart: date("week_start").notNull(),
  weekEnd: date("week_end").notNull(),
  content: jsonb("content").notNull(),
  temperature: text("temperature"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
