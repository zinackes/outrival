import { pgTable, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";
import { monitors } from "./monitors";

export const alternativeStatusEnum = pgEnum("alternative_status", [
  "proposed", // suggested by Outrival, waiting on the user
  "accepted", // user accepted → a new monitor was created / source paused
  "rejected", // user dismissed the suggestion
  "manual_data", // user chose to enter the data manually instead
]);

export const alternativeTypeEnum = pgEnum("alternative_type", [
  "different_url", // follow a different public URL of the same product
  "manual_data_entry", // the user enters the important info themselves
  "pause_source", // pause this specific source (stop scraping it)
  "replace_competitor", // the competitor changed → replace or remove it
]);

// Alternatives proposed to the user when a monitor becomes unscrapable (patch-23).
// Instead of a flat "unavailable", the failure diagnosis drives 1-3 actionable
// options the user can accept. Kept per-monitor; resolution is always explicit.
export const monitorAlternatives = pgTable("monitor_alternatives", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  monitorId: text("monitor_id")
    .notNull()
    .references(() => monitors.id, { onDelete: "cascade" }),
  type: alternativeTypeEnum("type").notNull(),
  // User-facing label, e.g. "Follow blog.linear.app/changelog instead".
  description: text("description").notNull(),
  // For different_url: the candidate URL to follow.
  suggestedUrl: text("suggested_url"),
  // Why this alternative is being offered (shown as the supporting line).
  rationale: text("rationale"),
  status: alternativeStatusEnum("status").notNull().default("proposed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (t) => [
  // Alternatives are always looked up per monitor; also covers the monitors-FK teardown.
  index("monitor_alternatives_monitor_idx").on(t.monitorId),
]);

export type MonitorAlternative = InferSelectModel<typeof monitorAlternatives>;
