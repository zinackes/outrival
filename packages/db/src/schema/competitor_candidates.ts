import { pgTable, text, timestamp, real, pgEnum } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const candidateStatusEnum = pgEnum("candidate_status", [
  "new",
  "dismissed",
  "added",
]);

export const competitorCandidates = pgTable("competitor_candidates", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  title: text("title"),
  overlapScore: real("overlap_score"),
  reason: text("reason"),
  status: candidateStatusEnum("status").notNull().default("new"),
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
});
