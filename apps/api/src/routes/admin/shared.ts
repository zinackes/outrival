import { db, auditLog } from "@outrival/db";
import { logger } from "@outrival/shared";

export type AdminVariables = { user: { id: string; email: string }; session: unknown };

// Audit trail for sensitive actions. Best-effort: a logging failure must never
// break the admin action itself.
export async function logAudit(
  actorEmail: string,
  action: string,
  targetType: string | null,
  targetId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorEmail,
      action,
      targetType,
      targetId,
      metadata: metadata ?? null,
    });
  } catch (err) {
    logger.error({ err, action }, "audit log insert failed");
  }
}

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function rate(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}
