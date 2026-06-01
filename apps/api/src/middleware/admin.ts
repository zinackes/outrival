import { createMiddleware } from "hono/factory";

// "admin" = SaaS operator, identified by an email allowlist — NEVER the org
// "owner" role (that would expose every customer's data). Empty allowlist →
// nobody passes (safe default). Read once at module load; restart to change.
const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && adminEmails.includes(email.toLowerCase());
}

// Must run AFTER authMiddleware (which sets c.get("user")).
export const adminMiddleware = createMiddleware<{
  Variables: { user: { id: string; email: string } };
}>(async (c, next) => {
  const user = c.get("user");
  if (!isAdminEmail(user?.email)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
});
