import { pgTable, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { competitors } from "./competitors";

export const selfChangeStatusEnum = pgEnum("self_change_status", [
  "pending", // detected, waiting on the user's decision
  "accepted", // user validated → profile updated
  "modified", // user edited manually instead of accepting the raw value
  "ignored", // user explicitly dismissed it, profile untouched
]);

export const selfChangeSeverityEnum = pgEnum("self_change_severity", [
  "minor", // e.g. a tier price changed
  "major", // e.g. new category/audience, repositioning
]);

// Changes detected on the user's own product site (type = "self"). Kept distinct
// from signals on purpose: the user resolves these on the "My product" page and
// no signal_feed entry / alert is ever produced for the self-competitor.
export const selfProductChanges = pgTable("self_product_changes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  selfCompetitorId: text("self_competitor_id")
    .notNull()
    .references(() => competitors.id, { onDelete: "cascade" }),
  // Which part of the profile moved, e.g. "pricing", "features", "category".
  fieldPath: text("field_path").notNull(),
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),
  // Short human-readable summary of the change, shown in the pending-changes UI.
  summary: text("summary"),
  severity: selfChangeSeverityEnum("severity").notNull(),
  status: selfChangeStatusEnum("status").notNull().default("pending"),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});
