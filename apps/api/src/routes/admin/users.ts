import { Hono } from "hono";
import { and, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { db, organizations, users, competitors, monitors } from "@outrival/db";
import { tasks } from "@trigger.dev/sdk/v3";
import { logAudit, type AdminVariables } from "./shared";

export const usersRouter = new Hono<{ Variables: AdminVariables }>();

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
    user: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt },
    org: org
      ? { id: org.id, name: org.name, slug: org.slug, plan: org.plan, planPeriod: org.planPeriod }
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
