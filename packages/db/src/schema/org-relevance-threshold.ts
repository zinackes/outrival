import { pgTable, text, timestamp, integer, real } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { organizations } from "./organizations";

// Patch-26: per-org relevance threshold (layer 1 of notification moderation).
// Starts at the default and is auto-adjusted weekly from the org's quality
// feedback (patch-21) by relevance-threshold-recalculation.job.ts. A signal whose
// persisted relevanceScore is below this threshold is silenced (not emailed).
export const orgRelevanceThreshold = pgTable("org_relevance_threshold", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id")
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: "cascade" }),

  threshold: real("threshold").notNull().default(0.5), // 0-1
  // "default" (untouched) | "auto_adjusted" (from feedback) | "user_set" (manual).
  source: text("source").notNull().default("default"),
  feedbackCountAtCalc: integer("feedback_count_at_calc").default(0),
  lastRecalculatedAt: timestamp("last_recalculated_at"),
});

export type OrgRelevanceThreshold = InferSelectModel<typeof orgRelevanceThreshold>;
export type NewOrgRelevanceThreshold = InferInsertModel<typeof orgRelevanceThreshold>;
