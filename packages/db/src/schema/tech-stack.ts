import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";
import { competitors } from "./competitors";

// Current detected tech stack per competitor (patch-18). Postgres holds the
// present state (what's active now, powering the competitor profile section);
// The `tech_stack_history` table holds the appearance/disappearance timeline.
// One row per (competitor, tech); a tech that disappears is kept with
// isActive=false (and reactivated in place if it comes back) rather than deleted,
// so firstDetectedAt and the history stay intact.
export const techStackEntries = pgTable(
  "tech_stack_entries",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    competitorId: text("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    techId: text("tech_id").notNull(), // catalog id, e.g. "stripe"
    techName: text("tech_name").notNull(),
    category: text("category").notNull(),
    importance: text("importance").notNull(),
    evidence: jsonb("evidence").notNull().$type<string[]>(),
    firstDetectedAt: timestamp("first_detected_at").notNull().defaultNow(),
    lastDetectedAt: timestamp("last_detected_at").notNull().defaultNow(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("tech_stack_entries_competitor_tech_uq").on(t.competitorId, t.techId)],
);

export type TechStackEntry = InferSelectModel<typeof techStackEntries>;
