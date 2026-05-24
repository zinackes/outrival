import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { signals } from "./signals";
import { organizations } from "./organizations";

export const alertChannelEnum = pgEnum("alert_channel", ["email", "slack", "webhook"]);

export const alerts = pgTable("alerts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  signalId: text("signal_id").notNull().references(() => signals.id),
  orgId: text("org_id").notNull().references(() => organizations.id),
  channel: alertChannelEnum("channel").notNull(),
  sentAt: timestamp("sent_at"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
