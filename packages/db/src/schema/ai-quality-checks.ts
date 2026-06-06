import {
  pgTable,
  text,
  timestamp,
  jsonb,
  boolean,
  doublePrecision,
  index,
} from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { users } from "./users";
import { organizations } from "./organizations";

// Anti-hallucination quality state (patch-24). The append-only `ai_runs`
// table (patch-02) records *volume*; this Postgres table holds the *mutable* per-output
// grounding / self-check / human-review state that ai_runs (no row id, no FK, no UPDATE)
// can't. One row per fresh AI generation that went through groundedAiCall. The UI looks
// a check up by (targetType, targetId) to surface a ConfidenceDot / flagged warning.

export const aiQualityChecks = pgTable(
  "ai_quality_checks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Logical AI task name, aligned with ai_runs.task (e.g. "classify_change",
    // "generate_signal", "generate_battle_card"). Plain text — the set spans 12+
    // internal tasks and isn't worth an enum migration.
    aiTask: text("ai_task").notNull(),
    // Which domain entity this output became, so the UI/API can join back to it.
    // e.g. "signal" | "battle_card" | "candidate" | "digest" | "competitor_summary"
    // | "product_profile" | "overlap_scoring" | "sectoral_signal".
    targetType: text("target_type").notNull(),
    // ID of that entity. Null for call-level checks with no single target row
    // (e.g. a batch overlap scoring). No FK: targets live in different tables.
    targetId: text("target_id"),
    // Org the output belongs to, when known — drives metrics filtering and the
    // ops review queue. Nullable: some tasks run before a signal/org is resolved.
    orgId: text("org_id").references(() => organizations.id, { onDelete: "cascade" }),

    // The model's self-reported confidence in its own output.
    confidence: text("confidence"), // "low" | "medium" | "high" | null
    // Array<{ assertion, sourceQuote, position? }> the model cited from the source.
    citations: jsonb("citations"),
    // { passed, score, failedCitations, validCitations } from validateCitations.
    groundingValidation: jsonb("grounding_validation"),
    // Denormalised grounding score (ratio of valid citations) for cheap metric scans.
    groundingScore: doublePrecision("grounding_score"),

    // { passed, issues, confidenceAdjustment, reviewerConfidence } when a 2nd pass ran.
    selfCheckResult: jsonb("self_check_result"),
    // Why the self-check ran: "systematic_battle_card" | "sampling" | "low_confidence".
    selfCheckTriggeredBy: text("self_check_triggered_by"),

    // True when the self-check failed → surfaced to the user (transparent warning,
    // content preserved) and queued for human review in /admin/ai-review-queue.
    flaggedForHumanReview: boolean("flagged_for_human_review").notNull().default(false),
    flaggedAt: timestamp("flagged_at"),

    // Human (or user self-) resolution of a flagged output.
    reviewedAt: timestamp("reviewed_at"),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    // "correct" | "hallucination_confirmed" | "false_positive" | null
    reviewResolution: text("review_resolution"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // UI/API lookup: "is there a quality check for this signal/battle card?".
    index("ai_quality_checks_target_idx").on(t.targetType, t.targetId),
    // Review queue: flagged & unresolved, newest first.
    index("ai_quality_checks_flagged_idx").on(t.flaggedForHumanReview, t.createdAt),
    // Metrics: hallucination rate per task over a window.
    index("ai_quality_checks_task_idx").on(t.aiTask, t.createdAt),
  ],
);

export type AiQualityCheck = InferSelectModel<typeof aiQualityChecks>;
export type NewAiQualityCheck = InferInsertModel<typeof aiQualityChecks>;
