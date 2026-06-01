import { pgTable, text, timestamp, boolean, pgEnum } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const notificationTypeEnum = pgEnum("notification_type", [
  "signal",
  "new_competitor",
  // A change detected on the user's own product site (patch-12). Routed here
  // instead of a signal — the user resolves it on the "My product" page.
  "self_change",
  // The first post-onboarding analysis pass finished (all selected competitors
  // have an AI summary, or the watcher timed out). Lets the user leave the
  // onboarding "done" screen for the dashboard and get pinged when it's ready.
  "onboarding_complete",
]);

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  linkUrl: text("link_url"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
