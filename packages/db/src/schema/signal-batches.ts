import { pgTable, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { organizations } from "./organizations";
import { competitors } from "./competitors";

// Patch-26: layer 5 (batching). 3+ similar signals (same competitor + same
// category) within BATCHING_WINDOW_HOURS get grouped into one batch with an AI
// summary, instead of N separate notifications. signal-batching.job.ts builds
// these and stamps signals.batchedIntoId. Critical signals are never batched.
export const signalBatches = pgTable("signal_batches", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  competitorId: text("competitor_id")
    .notNull()
    .references(() => competitors.id, { onDelete: "cascade" }),

  signalIds: jsonb("signal_ids").$type<string[]>().notNull(),
  category: text("category").notNull(),
  count: integer("count").notNull(),
  summary: text("summary"), // AI-generated, English
  highestSeverity: text("highest_severity").notNull(),

  windowStart: timestamp("window_start").notNull(),
  windowEnd: timestamp("window_end").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // signal-batching cron groups by (org, competitor); also covers eraseOrg cascade.
  index("signal_batches_org_competitor_idx").on(t.orgId, t.competitorId),
]);

export type SignalBatch = InferSelectModel<typeof signalBatches>;
export type NewSignalBatch = InferInsertModel<typeof signalBatches>;
