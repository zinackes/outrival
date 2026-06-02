import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
});
