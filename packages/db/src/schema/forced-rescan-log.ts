import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { users } from "./users";
import { organizations } from "./organizations";
import { monitors } from "./monitors";

// Patch-27 — audit + analytics trail for user-forced re-scans. The daily per-tier
// limit is counted from this table (authoritative; Redis is only a fast-path that
// no-ops without Upstash). `orgId` is denormalised so the limit can read the org's
// plan and the admin dashboard can break re-scans down by tier without a re-join.
// `hadNewSignal` / `resultCapturedAt` are filled in by the scrape worker once the
// forced run finishes, powering the "useful vs wasted re-scan" ratio.
export const forcedRescanLog = pgTable("forced_rescan_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  monitorId: text("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
  taskId: text("task_id"),
  triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
  resultCapturedAt: timestamp("result_captured_at"),
  hadNewSignal: boolean("had_new_signal"),
});
