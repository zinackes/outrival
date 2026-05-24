import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { monitors } from "./monitors";

export const snapshotStatusEnum = pgEnum("snapshot_status", [
  "success", "failed", "partial",
]);

export const snapshots = pgTable("snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  monitorId: text("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull(),
  contentHash: text("content_hash").notNull(),
  status: snapshotStatusEnum("status").notNull().default("success"),
  scrapedAt: timestamp("scraped_at").notNull().defaultNow(),
});
