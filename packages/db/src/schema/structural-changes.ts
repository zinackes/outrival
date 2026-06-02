import { pgTable, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";
import { competitors } from "./competitors";

export const structuralChangeTypeEnum = pgEnum("structural_change_type", [
  "pivot", // the content changed radically (different product)
  "site_dead", // persistent 404 / gone
  "acquired", // redirect to another domain / acquisition wording
  "category_shift", // the AI judges the content no longer fits the profile
]);

export const structuralChangeStatusEnum = pgEnum("structural_change_status", [
  "detected", // detected by Outrival, awaiting the user's decision
  "confirmed", // user confirmed the change is real
  "false_positive", // user flagged it as a false positive
  "resolved", // user took an action (paused, replaced, etc.)
]);

// A radical change in a competitor's site (pivot / death / acquisition), patch-23.
// Detected by combining a structural signal (text + pHash diff over consecutive
// stable scrapes) with an AI profile-match verdict, so A/B tests and redesigns
// don't trip it. The user must resolve it explicitly — no auto-resolution.
export const structuralChanges = pgTable("structural_changes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  competitorId: text("competitor_id")
    .notNull()
    .references(() => competitors.id, { onDelete: "cascade" }),
  type: structuralChangeTypeEnum("type").notNull(),
  // Supporting data: text diff ratio, pHash distance, AI reasoning + summary.
  evidence: jsonb("evidence").notNull(),
  confidence: text("confidence").notNull(), // "high" | "medium" | "low"
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  status: structuralChangeStatusEnum("status").notNull().default("detected"),
  resolvedAt: timestamp("resolved_at"),
  // Free-form resolution outcome, e.g. "replaced_with:<id>", "paused".
  resolution: text("resolution"),
  // When the proactive email for this change was last sent — used to throttle to
  // at most one email per competitor per month.
  emailSentAt: timestamp("email_sent_at"),
});

export type StructuralChange = InferSelectModel<typeof structuralChanges>;
