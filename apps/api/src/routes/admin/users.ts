import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import {
  db,
  organizations,
  users,
  competitors,
  monitors,
  user as authUser,
  session as authSession,
} from "@outrival/db";
import { tasks } from "@trigger.dev/sdk/v3";
import { auth } from "../../lib/auth";
import { eraseOrg } from "../../lib/erase-org";
import { logAudit, type AdminVariables } from "./shared";

export const usersRouter = new Hono<{ Variables: AdminVariables }>();

const planValues = ["free", "starter", "pro", "business"] as const;
const periodValues = ["monthly", "yearly"] as const;

// --- User/org search ---
usersRouter.get("/users", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const pattern = `%${q}%`;
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      suspendedAt: users.suspendedAt,
      createdAt: users.createdAt,
      orgId: organizations.id,
      orgName: organizations.name,
      plan: organizations.plan,
    })
    .from(users)
    .leftJoin(organizations, eq(organizations.id, users.orgId))
    .where(
      q
        ? or(
            ilike(users.email, pattern),
            ilike(users.name, pattern),
            ilike(organizations.name, pattern),
          )
        : undefined,
    )
    .orderBy(desc(users.createdAt))
    .limit(50);

  return c.json({ users: rows });
});

// --- User detail: org, competitors, monitors + last scrape of each ---
usersRouter.get("/users/:id", async (c) => {
  const id = c.req.param("id");
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!user) return c.json({ error: "Not found" }, 404);

  const org = user.orgId
    ? await db.query.organizations.findFirst({ where: eq(organizations.id, user.orgId) })
    : null;

  const comps = org
    ? await db
        .select({
          id: competitors.id,
          name: competitors.name,
          url: competitors.url,
          type: competitors.type,
        })
        .from(competitors)
        .where(and(eq(competitors.orgId, org.id), isNull(competitors.deletedAt)))
    : [];

  const monitorRows = comps.length
    ? await db
        .select({
          id: monitors.id,
          competitorId: monitors.competitorId,
          sourceType: monitors.sourceType,
          isActive: monitors.isActive,
          requiresLevel: monitors.requiresLevel,
          markedUnscrapable: monitors.markedUnscrapable,
          lastRunAt: monitors.lastRunAt,
          nextRunAt: monitors.nextRunAt,
          lastChangedAt: monitors.lastChangedAt,
          lastFailedAt: monitors.lastFailedAt,
          lastError: monitors.lastError,
        })
        .from(monitors)
        .where(
          inArray(
            monitors.competitorId,
            comps.map((x) => x.id),
          ),
        )
    : [];

  const monitorsByCompetitor = comps.map((comp) => ({
    ...comp,
    monitors: monitorRows.filter((m) => m.competitorId === comp.id),
  }));

  await logAudit(c.get("user").email, "view_user", "user", id, { email: user.email });

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      suspendedAt: user.suspendedAt,
      createdAt: user.createdAt,
    },
    org: org
      ? {
          id: org.id,
          name: org.name,
          slug: org.slug,
          plan: org.plan,
          planPeriod: org.planPeriod,
          hasActiveStripeSub: !!org.stripeSubscriptionId,
        }
      : null,
    competitors: monitorsByCompetitor,
  });
});

// --- Force a scrape of a monitor ---
usersRouter.post("/monitors/:id/force-scrape", async (c) => {
  const id = c.req.param("id");
  const monitor = await db.query.monitors.findFirst({ where: eq(monitors.id, id) });
  if (!monitor) return c.json({ error: "Not found" }, 404);

  const handle = await tasks.trigger("scrape-monitor", { monitorId: id, force: true });
  await logAudit(c.get("user").email, "force_scrape", "monitor", id, {
    competitorId: monitor.competitorId,
    sourceType: monitor.sourceType,
  });

  return c.json({ ok: true, runId: handle.id });
});

// --- Set a user's org plan (operator grant — does NOT touch Stripe) ---
const planSchema = z.object({
  plan: z.enum(planValues),
  planPeriod: z.enum(periodValues).nullable(),
});

usersRouter.patch("/users/:id/plan", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = planSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body" }, 400);

  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!user) return c.json({ error: "Not found" }, 404);
  if (!user.orgId) return c.json({ error: "User has no org" }, 400);

  await db
    .update(organizations)
    .set({ plan: parsed.data.plan, planPeriod: parsed.data.planPeriod })
    .where(eq(organizations.id, user.orgId));

  await logAudit(c.get("user").email, "update_plan", "user", id, {
    email: user.email,
    plan: parsed.data.plan,
    planPeriod: parsed.data.planPeriod,
  });

  return c.json({ ok: true });
});

// --- Resend a sign-in code/link to help a user log in ---
usersRouter.post("/users/:id/send-login-link", async (c) => {
  const id = c.req.param("id");
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!user) return c.json({ error: "Not found" }, 404);
  if (user.suspendedAt) return c.json({ error: "User is suspended" }, 400);

  await auth.api.sendVerificationOTP({
    headers: c.req.raw.headers,
    body: { email: user.email, type: "sign-in" },
  });
  await logAudit(c.get("user").email, "send_login_link", "user", id, { email: user.email });

  return c.json({ ok: true });
});

// --- Suspend / unsuspend (lock the account out of the product) ---
usersRouter.post("/users/:id/suspend", async (c) => {
  const id = c.req.param("id");
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!user) return c.json({ error: "Not found" }, 404);

  await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, id));
  // Kill existing sessions so the lock-out is immediate, not next-login.
  await db.delete(authSession).where(eq(authSession.userId, id));

  await logAudit(c.get("user").email, "suspend", "user", id, { email: user.email });
  return c.json({ ok: true });
});

usersRouter.post("/users/:id/unsuspend", async (c) => {
  const id = c.req.param("id");
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!user) return c.json({ error: "Not found" }, 404);

  await db.update(users).set({ suspendedAt: null }).where(eq(users.id, id));
  await logAudit(c.get("user").email, "unsuspend", "user", id, { email: user.email });
  return c.json({ ok: true });
});

// --- Permanently delete a user and their workspace (GDPR erasure by operator) ---
const deleteSchema = z.object({ confirm: z.string() });

usersRouter.delete("/users/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body" }, 400);

  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!user) return c.json({ error: "Not found" }, 404);
  if (parsed.data.confirm !== user.email) return c.json({ error: "confirm_mismatch" }, 400);

  // Erase the workspace first (detachUsers:false → the org delete cascades the app
  // `users` row away), then remove the Better Auth identity (sessions/accounts
  // cascade from `user`). Belt-and-suspenders cleanup of the app row for the
  // no-org case where nothing cascaded it.
  if (user.orgId) await eraseOrg(user.orgId, { detachUsers: false });
  await db.delete(authUser).where(eq(authUser.id, id));
  await db.delete(users).where(eq(users.id, id));

  await logAudit(c.get("user").email, "delete_user", "user", id, { email: user.email });
  return c.json({ ok: true });
});
