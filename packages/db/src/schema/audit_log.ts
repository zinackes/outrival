import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
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
}, (t) => [
  // The table had no index at all, on an append-only trail that never gets purged
  // (deliberately — it is operator data). One index, on the one access path that
  // exists: /admin/audit-log reads ORDER BY created_at DESC LIMIT 100. No
  // actor/target index, because no route filters on those yet (`code:PER-38`).
  index("audit_log_created_idx").on(t.createdAt),
]);

export type AuditLogEntry = InferSelectModel<typeof auditLog>;
