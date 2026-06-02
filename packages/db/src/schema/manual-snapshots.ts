import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";
import { monitors } from "./monitors";
import { users } from "./users";

// User-entered data for a source we can't scrape (patch-23). When a monitor is
// unscrapable, the user can enter the important info themselves; it's stored here
// and tagged "manual" everywhere it surfaces (FreshnessDot "entered manually on
// X") so the data stays transparent. Shape of `data` depends on sourceType.
export const manualSnapshots = pgTable("manual_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  monitorId: text("monitor_id")
    .notNull()
    .references(() => monitors.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  sourceType: text("source_type").notNull(),
  data: jsonb("data").notNull(),
  // Screenshot URL or link the user provided as evidence (optional).
  evidenceUrl: text("evidence_url"),
  enteredAt: timestamp("entered_at").notNull().defaultNow(),
});

export type ManualSnapshot = InferSelectModel<typeof manualSnapshots>;
