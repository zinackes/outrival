import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { digests } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const digestsRouter = new Hono<{ Variables: Variables }>();

digestsRouter.use("*", authMiddleware);

digestsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const list = await db.query.digests.findMany({
    where: eq(digests.orgId, orgId),
    orderBy: desc(digests.weekStart),
    limit: 50,
  });
  return c.json({ digests: list });
});

digestsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const digest = await db.query.digests.findFirst({
    where: and(eq(digests.id, id), eq(digests.orgId, orgId)),
  });
  if (!digest) return c.json({ error: "Not found" }, 404);

  return c.json({ digest });
});
