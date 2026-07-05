import { pgTable, text, timestamp, jsonb, date, index } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const digests = pgTable("digests", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull().references(() => organizations.id),
  weekStart: date("week_start").notNull(),
  weekEnd: date("week_end").notNull(),
  content: jsonb("content").notNull(),
  temperature: text("temperature"),
  // "weekly" = the Monday briefing (cron + on-demand preview); "daily" = a persisted
  // record of a daily briefing send. Existing rows default to weekly. Weekly
  // idempotency/finalize queries MUST scope to period="weekly" so a daily row that
  // happens to share a Monday date can't be mistaken for the week's digest.
  period: text("period").notNull().default("weekly"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // Weekly digest idempotency lookup (org_id, week_start) + eraseOrg delete.
  index("digests_org_week_idx").on(t.orgId, t.weekStart),
]);
