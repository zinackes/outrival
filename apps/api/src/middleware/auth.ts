import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { users } from "@outrival/db";
import { auth } from "../lib/auth";
import { db } from "../lib/db";

export const authMiddleware = createMiddleware(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  // Suspended accounts (set by an operator from /admin) are locked out: existing
  // sessions are rejected here. Lightweight PK lookup; the OTP send path is also
  // gated so no new code is ever issued to a suspended email. We grab orgId in the
  // same row so ensureUserOrg can reuse it (via getContext) instead of re-reading
  // the users table on every authenticated request.
  const appUser = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { suspendedAt: true, orgId: true },
  });
  if (appUser?.suspendedAt) return c.json({ error: "Account suspended" }, 403);

  c.set("user", session.user);
  c.set("session", session.session);
  // Null for a brand-new user with no org yet — ensureUserOrg falls through to its
  // create path in that case.
  c.set("orgId", appUser?.orgId ?? null);
  await next();
});
