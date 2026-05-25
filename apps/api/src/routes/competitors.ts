import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { competitors, monitors, changes } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const competitorsRouter = new Hono<{ Variables: Variables }>();

competitorsRouter.use("*", authMiddleware);

const CreateCompetitorSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  description: z.string().optional(),
});

competitorsRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = CreateCompetitorSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const [competitor] = await db
    .insert(competitors)
    .values({
      orgId,
      name: parsed.data.name,
      url: parsed.data.url,
      description: parsed.data.description ?? null,
    })
    .returning();
  if (!competitor) return c.json({ error: "Failed to create competitor" }, 500);

  const createdMonitors = await db
    .insert(monitors)
    .values([
      { competitorId: competitor.id, sourceType: "homepage", frequency: "daily" },
      { competitorId: competitor.id, sourceType: "pricing", frequency: "daily" },
      { competitorId: competitor.id, sourceType: "blog", frequency: "weekly" },
    ])
    .returning();

  return c.json({ competitor, monitors: createdMonitors }, 201);
});

competitorsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const list = await db.query.competitors.findMany({
    where: and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)),
    orderBy: desc(competitors.createdAt),
  });
  return c.json({ competitors: list });
});

competitorsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await db.query.competitors.findFirst({
    where: and(eq(competitors.id, id), eq(competitors.orgId, orgId)),
  });
  if (!competitor) return c.json({ error: "Not found" }, 404);

  const monitorList = await db.query.monitors.findMany({
    where: eq(monitors.competitorId, competitor.id),
  });

  const recentChanges = await db.query.changes.findMany({
    where: eq(changes.monitorId, monitorList[0]?.id ?? ""),
    orderBy: desc(changes.detectedAt),
    limit: 20,
  });

  return c.json({ competitor, monitors: monitorList, recentChanges });
});

competitorsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const competitor = await db.query.competitors.findFirst({
    where: and(eq(competitors.id, id), eq(competitors.orgId, orgId)),
  });
  if (!competitor) return c.json({ error: "Not found" }, 404);

  await db.update(competitors).set({ deletedAt: new Date() }).where(eq(competitors.id, id));
  return c.json({ ok: true });
});
