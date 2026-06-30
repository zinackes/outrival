import { pgTable, text, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { products } from "./products";

// One row per (org, product) tracking the last on-demand competitor discovery
// (patch-22 intelligent rate limiting, made product-aware in patch-28). Discovery is
// expensive (Exa + AI overlap scoring), so the UI greys out "Find competitors" when
// nothing changed: a run is "fresh" while it's recent AND the product's self-profile
// hasn't been edited since. The monthly quota counter (detectCount) stays org-level —
// it's summed across the org's product rows.
export const discoveryRuns = pgTable("discovery_runs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // patch-28 — the product this discovery run targeted. Nullable for legacy rows
  // (backfilled to the primary product). Staleness is keyed per product so a new
  // product reads as "never_run" even when the primary was just discovered.
  productId: text("product_id").references(() => products.id, { onDelete: "cascade" }),
  lastDiscoveryAt: timestamp("last_discovery_at").notNull().defaultNow(),
  // The self-profile edit timestamp this run was based on, so a later edit marks
  // the discovery stale (suggest re-running) without comparing the whole profile.
  basedOnProfileUpdateAt: timestamp("based_on_profile_update_at"),
  // Per-tier monthly discovery quota (tier-limits, 2026-06-04). Each product row
  // carries its own calendar-month counter (detectCountMonth "YYYY-MM", resets
  // detectCount to 0 on rollover); the org-level monthly usage is the SUM across the
  // org's rows for the current month. On-demand /detect only — the weekly cron
  // auto-discovery doesn't consume the quota.
  detectCount: integer("detect_count").notNull().default(0),
  detectCountMonth: text("detect_count_month"),
}, (t) => [
  // One staleness/quota row per (org, product). Null productId rows (legacy, pre
  // backfill) coexist since Postgres treats nulls as distinct.
  uniqueIndex("discovery_runs_org_product_uq").on(t.orgId, t.productId),
]);
