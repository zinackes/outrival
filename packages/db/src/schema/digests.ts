import { pgTable, text, timestamp, jsonb, date, index } from "drizzle-orm/pg-core";
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
}, (t) => [
  // Weekly digest idempotency lookup (org_id, week_start) + eraseOrg delete.
  index("digests_org_week_idx").on(t.orgId, t.weekStart),
]);
