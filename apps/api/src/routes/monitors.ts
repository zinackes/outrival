import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { monitors, competitors } from "@outrival/db";
import { tasks } from "@trigger.dev/sdk/v3";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const monitorsRouter = new Hono<{ Variables: Variables }>();

monitorsRouter.use("*", authMiddleware);

monitorsRouter.post("/:id/run", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const monitor = await db.query.monitors.findFirst({ where: eq(monitors.id, id) });
  if (!monitor) return c.json({ error: "Monitor not found" }, 404);

  const competitor = await db.query.competitors.findFirst({
    where: and(
      eq(competitors.id, monitor.competitorId),
      eq(competitors.orgId, orgId),
      isNull(competitors.deletedAt),
    ),
  });
  if (!competitor) return c.json({ error: "Forbidden" }, 403);

  const handle = await tasks.trigger("scrape-monitor", {
    monitorId: monitor.id,
    force: true,
  });

  return c.json({ runId: handle.id, monitorId: monitor.id });
});
