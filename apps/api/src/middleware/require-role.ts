import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { users } from "@outrival/db";
import { db } from "../lib/db";

// Role gate for actions that are not every member's to take (audit 2026-09-02,
// S-04). `users.role` has held owner|admin|member since the schema was written,
// but only three routes ever read it: billing was wide open, so any member of a
// workspace could upgrade the plan, downgrade it, or swap the card on file.
//
// Runs AFTER authMiddleware, which is what puts `user` on the context.
export function requireRole(...roles: ("owner" | "admin" | "member")[]) {
  return createMiddleware<{ Variables: { user: { id: string } } }>(async (c, next) => {
    const user = c.get("user");

    const row = await db.query.users.findFirst({
      where: eq(users.id, user.id),
      columns: { role: true, orgId: true },
    });

    // No organization yet means nothing to protect and nobody to protect it from:
    // this user is about to become the owner of the org ensureUserOrg creates for
    // them. Refusing here would 403 a brand-new account out of its own onboarding.
    if (!row?.orgId) return next();

    if (!roles.includes(row.role)) {
      return c.json({ error: "insufficient_role" }, 403);
    }
    return next();
  });
}
