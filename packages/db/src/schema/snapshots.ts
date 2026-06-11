import { pgTable, text, timestamp, pgEnum, jsonb, integer, index } from "drizzle-orm/pg-core";
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
  // Semantic structure of a homepage capture (patch-16): hero, sections, nav,
  // footer, social proof. Present only for homepage snapshots scraped post-patch;
  // null for other sources and for pre-patch snapshots (diff falls back to lexical
  // for one iteration). Typed as HomepageStructure from @outrival/scrapers at the
  // call site — kept untyped here so @outrival/db stays a leaf package.
  homepageStructure: jsonb("homepage_structure"),
  // Perceptual (dHash) of the screenshot as a hex string (patch-17): catches a
  // visual redesign the text diff misses. Homepage snapshots with a screenshot only.
  screenshotPhash: text("screenshot_phash"),
  // Char length of the extracted visible content (patch-17): feeds the anti-void
  // median guard. Populated on every snapshot post-patch; null for older rows.
  contentSize: integer("content_size"),
}, (t) => [
  // Every scrape fetches the previous snapshot: latest per monitor.
  index("snapshots_monitor_scraped_idx").on(t.monitorId, t.scrapedAt),
]);
