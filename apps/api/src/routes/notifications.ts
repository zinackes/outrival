import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { and, asc, count, desc, eq, gt } from "drizzle-orm";
import { notifications } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const notificationsRouter = new Hono<{ Variables: Variables }>();

notificationsRouter.use("*", authMiddleware);

notificationsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  const rows = await db.query.notifications.findMany({
    where: eq(notifications.orgId, orgId),
    orderBy: desc(notifications.createdAt),
    limit,
  });

  return c.json({ notifications: rows });
});

notificationsRouter.get("/unread-count", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const [row] = await db
    .select({ count: count() })
    .from(notifications)
    .where(and(eq(notifications.orgId, orgId), eq(notifications.isRead, false)));

  return c.json({ count: row?.count ?? 0 });
});

notificationsRouter.patch("/:id/read", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.id, id), eq(notifications.orgId, orgId)));

  return c.json({ ok: true });
});

notificationsRouter.post("/read-all", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.orgId, orgId), eq(notifications.isRead, false)));

  return c.json({ ok: true });
});

notificationsRouter.get("/stream", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  return streamSSE(c, async (stream) => {
    let lastCheck = new Date();
    let aborted = false;
    stream.onAbort(() => {
      aborted = true;
    });

    await stream.writeSSE({ event: "ready", data: JSON.stringify({ ts: Date.now() }) });

    while (!aborted) {
      const fresh = await db.query.notifications.findMany({
        where: and(
          eq(notifications.orgId, orgId),
          gt(notifications.createdAt, lastCheck),
        ),
        orderBy: asc(notifications.createdAt),
        limit: 20,
      });

      for (const n of fresh) {
        await stream.writeSSE({
          event: "notification",
          data: JSON.stringify(n),
        });
        if (new Date(n.createdAt) > lastCheck) {
          lastCheck = new Date(n.createdAt);
        }
      }

      await stream.writeSSE({ event: "heartbeat", data: String(Date.now()) });
      await stream.sleep(3000);
    }
  });
});
