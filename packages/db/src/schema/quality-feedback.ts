import {
  pgTable,
  text,
  timestamp,
  jsonb,
  pgEnum,
  integer,
  index,
} from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { users } from "./users";
import { organizations } from "./organizations";

// Quality feedback on AI outputs (patch-21). DISTINCT from the patch-05 `feedback`
// table, which is the general bug/idea widget. The two coexist with different roles.

// Which AI output the verdict is about.
export const feedbackTargetTypeEnum = pgEnum("feedback_target_type", [
  "signal",
  "discovery_suggestion",
  "battle_card",
  "digest",
  "severity_classification",
  "nps",
]);

export const feedbackVerdictEnum = pgEnum("feedback_verdict", [
  "useful",
  "not_useful",
  "neutral",
]);

// Optional categorisation — never required.
export const feedbackReasonEnum = pgEnum("feedback_reason", [
  "irrelevant",
  "incorrect",
  "trivial",
  "too_high_severity",
  "too_low_severity",
  "duplicate",
  "outdated",
  "other",
]);

export const qualityFeedback = pgTable(
  "quality_feedback",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    targetType: feedbackTargetTypeEnum("target_type").notNull(),
    // ID of the targeted entity (signal id, candidate id, battle card id, digest
    // id, or a synthetic key for NPS). No FK: targets live in different tables.
    targetId: text("target_id").notNull(),
    verdict: feedbackVerdictEnum("verdict").notNull(),
    reason: feedbackReasonEnum("reason"),
    // 0-10 NPS score, only set for targetType="nps".
    npsScore: integer("nps_score"),
    freeText: text("free_text"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // One verdict per (user, target): the API upserts on this triplet.
    index("quality_feedback_user_target_idx").on(
      t.userId,
      t.targetType,
      t.targetId,
    ),
    // Pattern aggregation in the ops dashboard queries by (orgId, targetType, createdAt).
    index("quality_feedback_org_type_idx").on(t.orgId, t.targetType, t.createdAt),
  ],
);

export type QualityFeedback = InferSelectModel<typeof qualityFeedback>;
export type NewQualityFeedback = InferInsertModel<typeof qualityFeedback>;
