import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";

// Sensitive admin actions (patch-02). Append-only trail: which operator did what
// to which target. Not gated by org — admin = ADMIN_EMAILS allowlist operator.
export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(), // view_user | force_scrape | update_feedback
  targetType: text("target_type"), // user | monitor | feedback
  targetId: text("target_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AuditLogEntry = InferSelectModel<typeof auditLog>;
