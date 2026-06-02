import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { monitors } from "./monitors";

// Per-monitor memory of which homepage line "signatures" churn without meaning
// (patch-17). A line like "Used by 10,234 teams" normalizes to a signature with
// the number stripped; when the same signature keeps changing text across scrapes
// it's marked volatile and filtered out of diffs — replacing hardcoded regexes
// with something that adapts to each competitor. Reverts to analysable once the
// line is stable again for long enough.
export const volatileLines = pgTable(
  "volatile_lines",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    monitorId: text("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    /** Normalized line signature (numbers/dates/hashes/urls stripped). */
    pattern: text("pattern").notNull(),
    changeCount: integer("change_count").notNull().default(0),
    stableCount: integer("stable_count").notNull().default(0),
    isVolatile: boolean("is_volatile").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("volatile_lines_monitor_pattern_idx").on(t.monitorId, t.pattern)],
);
