import { pgTable, text, timestamp, boolean, pgEnum } from "drizzle-orm/pg-core";
import { changes } from "./changes";
import { organizations } from "./organizations";
import { competitors } from "./competitors";

export const severityEnum = pgEnum("severity", ["low", "medium", "high", "critical"]);
export const categoryEnum = pgEnum("category", [
  "pricing", "product", "hiring", "reviews", "content", "funding",
]);

export const signals = pgTable("signals", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  changeId: text("change_id").notNull().references(() => changes.id),
  orgId: text("org_id").notNull().references(() => organizations.id),
  competitorId: text("competitor_id").notNull().references(() => competitors.id),
  severity: severityEnum("severity").notNull(),
  category: categoryEnum("category").notNull(),
  insight: text("insight").notNull(),
  soWhat: text("so_what"),
  recommendedAction: text("recommended_action"),
  // Human-readable before/after of the main change, in plain language
  // ("Standard · $99/mo" → "Standard · $79/mo"), surfaced in the "Why this
  // insight?" panel. Nullable: pre-patch signals and failed extractions stay
  // null and the UI falls back gracefully (patch-14).
  humanChangeBefore: text("human_change_before"),
  humanChangeAfter: text("human_change_after"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
