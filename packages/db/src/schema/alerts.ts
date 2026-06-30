import { pgTable, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
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
}, (t) => [
  // Monitor teardown and signal detail both look alerts up by signal.
  index("alerts_signal_idx").on(t.signalId),
  // eraseOrg deletes alerts by org; without this it seq-scans the table.
  index("alerts_org_idx").on(t.orgId),
]);
