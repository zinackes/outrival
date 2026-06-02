import { pgTable, text, timestamp, boolean, real, pgEnum } from "drizzle-orm/pg-core";
import { changes } from "./changes";
import { organizations } from "./organizations";
import { competitors } from "./competitors";
import { users } from "./users";
import { signalBatches } from "./signal-batches";

export const severityEnum = pgEnum("severity", ["low", "medium", "high", "critical"]);
export const categoryEnum = pgEnum("category", [
  "pricing", "product", "hiring", "reviews", "content", "funding",
]);

export const signals = pgTable("signals", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  changeId: text("change_id").notNull().references(() => changes.id),
  orgId: text("org_id").notNull().references(() => organizations.id),
  competitorId: text("competitor_id").notNull().references(() => competitors.id),
  severity: severityEnum("severity").notNull(),
  category: categoryEnum("category").notNull(),
  insight: text("insight").notNull(),
  soWhat: text("so_what"),
  recommendedAction: text("recommended_action"),
  // Human-readable before/after of the main change, in plain language
  // ("Standard · $99/mo" → "Standard · $79/mo"), surfaced in the "Why this
  // insight?" panel. Nullable: pre-patch signals and failed extractions stay
  // null and the UI falls back gracefully (patch-14).
  humanChangeBefore: text("human_change_before"),
  humanChangeAfter: text("human_change_after"),
  // Strategic narrative for significant structured homepage changes (patch-16):
  // a 2-3 sentence contextual explanation, generated only when severity clears
  // HOMEPAGE_NARRATIVE_MIN_SEVERITY. Null for everything else and pre-patch
  // signals → the UI shows just the title (graceful fallback).
  narrative: text("narrative"),
  // Quality feedback actions (patch-21). When a user marks a signal "not useful"
  // it is hidden from their feed (soft, reversible by deleting the feedback). A
  // "too high/low severity" feedback writes severityOverride (+ who) which the UI
  // and downstream display prefer over the AI-classified `severity`.
  hiddenForUserAt: timestamp("hidden_for_user_at"),
  severityOverride: severityEnum("severity_override"),
  severityOverriddenBy: text("severity_overridden_by").references(() => users.id),
  // Notification moderation (patch-26). relevanceScore is the max composite
  // relevance of the structured homepage changes behind this signal (patch-17),
  // persisted here so the per-org threshold (layer 1) and the weekly recalc can
  // reason about it. Null for non-homepage / lexical signals → layer 1 skipped.
  relevanceScore: real("relevance_score"),
  // The dispatcher's decision for this signal: the channel it routed to, and —
  // when it was held back from an immediate email — why. The signal feed reads
  // filteredReason to show "N less relevant signals hidden". Both null until the
  // dispatcher runs (and for critical signals, which bypass every filter).
  dispatchedChannel: text("dispatched_channel"),
  filteredReason: text("filtered_reason"),
  filteredAt: timestamp("filtered_at"),
  // Set when this signal was rolled up into a batch (layer 5); the feed then
  // shows the batch instead of the individual signal.
  batchedIntoId: text("batched_into_id").references(() => signalBatches.id),
  // Stamped once a deferred signal (dispatchedChannel = digest_daily) has gone out
  // in a daily digest email — the daily digest job's idempotency marker.
  dailyDigestSentAt: timestamp("daily_digest_sent_at"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
