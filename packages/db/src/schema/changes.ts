import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { monitors } from "./monitors";
import { snapshots } from "./snapshots";

export const changes = pgTable("changes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  monitorId: text("monitor_id").notNull().references(() => monitors.id),
  snapshotBeforeId: text("snapshot_before_id").references(() => snapshots.id),
  snapshotAfterId: text("snapshot_after_id").notNull().references(() => snapshots.id),
  diffText: text("diff_text"),
  diffType: text("diff_type"),
  rawDiff: jsonb("raw_diff"),
  summary: text("summary"),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
});
