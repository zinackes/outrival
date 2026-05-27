import { pgTable, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

export const feedbackTypeEnum = pgEnum("feedback_type", ["bug", "idea", "other"]);
export const feedbackStatusEnum = pgEnum("feedback_status", ["new", "reviewed", "resolved"]);

export const feedback = pgTable("feedback", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").references(() => organizations.id, { onDelete: "set null" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  type: feedbackTypeEnum("type").notNull().default("bug"),
  message: text("message").notNull(),
  pageUrl: text("page_url"),
  consoleErrors: jsonb("console_errors"),
  screenshotR2Key: text("screenshot_r2_key"),
  userAgent: text("user_agent"),
  status: feedbackStatusEnum("status").notNull().default("new"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
