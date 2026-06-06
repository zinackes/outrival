import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

// One row per org tracking the last on-demand competitor discovery (patch-22
// intelligent rate limiting). Discovery is expensive (Exa + AI overlap scoring),
// so the UI greys out "Find competitors" when nothing changed: a run is "fresh"
// while it's recent AND the self-product profile hasn't been edited since.
export const discoveryRuns = pgTable("discovery_runs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  lastDiscoveryAt: timestamp("last_discovery_at").notNull().defaultNow(),
  // The self-profile edit timestamp this run was based on, so a later edit marks
  // the discovery stale (suggest re-running) without comparing the whole profile.
  basedOnProfileUpdateAt: timestamp("based_on_profile_update_at"),
  // Per-tier monthly discovery quota (tier-limits, 2026-06-04). This single row
  // doubles as the calendar-month counter: detectCountMonth is "YYYY-MM" and resets
  // detectCount to 0 when the month rolls over. On-demand /detect only — the weekly
  // cron auto-discovery doesn't consume the quota.
  detectCount: integer("detect_count").notNull().default(0),
  detectCountMonth: text("detect_count_month"),
});
