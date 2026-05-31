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
  // HTTP validators for conditional fetch (etag / last-modified). resolvedUrl is
  // the exact URL this snapshot's content came from (scrapers do path discovery),
  // so the next conditional pre-flight checks the right resource.
  etag: text("etag"),
  lastModified: text("last_modified"),
  resolvedUrl: text("resolved_url"),
});
