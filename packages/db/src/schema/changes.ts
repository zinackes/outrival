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
  // Typed structural diff for homepage changes (patch-16): a StructuredChange[]
  // (from @outrival/scrapers), set when diffType = "structured". classify-change
  // reads it to reason per-field and later enriches each entry with a significance
  // ("major" | "minor" | "trivial") for the "Why this insight?" breakdown. Null
  // for lexical (non-homepage / fallback) changes. Untyped here to keep
  // @outrival/db a leaf package — cast at the call site.
  structuredDiff: jsonb("structured_diff"),
  summary: text("summary"),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
});
