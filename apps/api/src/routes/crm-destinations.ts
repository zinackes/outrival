import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { crmDestinations } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { getOrgPlan, isFeatureAllowed } from "../lib/plan";
import { isSafeWebhookUrl, sendWebhook } from "../lib/crm-webhook";

type Variables = { user: { id: string } };

export const crmDestinationsRouter = new Hono<{ Variables: Variables }>();

crmDestinationsRouter.use("*", authMiddleware);

// Outbound webhook destinations (Phase C). Org-scoped. Secrets are never returned;
// the list exposes only `hasSecret`. See docs/distribution-team.md.

crmDestinationsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const rows = await db
    .select({
      id: crmDestinations.id,
      name: crmDestinations.name,
      url: crmDestinations.url,
      enabled: crmDestinations.enabled,
      secret: crmDestinations.secret,
      lastPushedAt: crmDestinations.lastPushedAt,
      createdAt: crmDestinations.createdAt,
    })
    .from(crmDestinations)
    .where(eq(crmDestinations.orgId, orgId))
    .orderBy(desc(crmDestinations.createdAt));
  return c.json({
    destinations: rows.map(({ secret, ...d }) => ({ ...d, hasSecret: Boolean(secret) })),
  });
});

crmDestinationsRouter.post("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const plan = await getOrgPlan(orgId);
  if (!isFeatureAllowed(plan, "crmIntegrations")) {
    return c.json({ error: "plan_locked_feature", feature: "crmIntegrations", plan }, 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    name?: unknown;
    url?: unknown;
    secret?: unknown;
  };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!name) return c.json({ error: "name_required" }, 400);
  if (!isSafeWebhookUrl(url)) return c.json({ error: "invalid_url" }, 400);
  const secret = typeof body.secret === "string" && body.secret ? body.secret.slice(0, 200) : null;

  const [row] = await db
    .insert(crmDestinations)
    .values({ orgId, name, url, secret })
    .returning({
      id: crmDestinations.id,
      name: crmDestinations.name,
      url: crmDestinations.url,
      enabled: crmDestinations.enabled,
      lastPushedAt: crmDestinations.lastPushedAt,
      createdAt: crmDestinations.createdAt,
    });
  return c.json({ destination: { ...row, hasSecret: Boolean(secret) } }, 201);
});

// Edit a destination in place — name/URL fixes and secret rotation without a
// delete/recreate cycle (which would lose lastPushedAt and briefly drop pushes).
// secret: a string sets it, null clears it, absent leaves it untouched.
crmDestinationsRouter.patch("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const body = (await c.req.json().catch(() => ({}))) as {
    name?: unknown;
    url?: unknown;
    secret?: unknown;
    enabled?: unknown;
  };

  const update: Partial<{
    name: string;
    url: string;
    secret: string | null;
    enabled: boolean;
  }> = {};
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (!name) return c.json({ error: "name_required" }, 400);
    update.name = name;
  }
  if (body.url !== undefined) {
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!isSafeWebhookUrl(url)) return c.json({ error: "invalid_url" }, 400);
    update.url = url;
  }
  if (body.secret !== undefined) {
    update.secret =
      typeof body.secret === "string" && body.secret ? body.secret.slice(0, 200) : null;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") return c.json({ error: "invalid_enabled" }, 400);
    update.enabled = body.enabled;
  }
  if (Object.keys(update).length === 0) return c.json({ error: "empty_update" }, 400);

  const [row] = await db
    .update(crmDestinations)
    .set(update)
    .where(and(eq(crmDestinations.id, id), eq(crmDestinations.orgId, orgId)))
    .returning({
      id: crmDestinations.id,
      name: crmDestinations.name,
      url: crmDestinations.url,
      enabled: crmDestinations.enabled,
      secret: crmDestinations.secret,
      lastPushedAt: crmDestinations.lastPushedAt,
      createdAt: crmDestinations.createdAt,
    });
  if (!row) return c.json({ error: "not_found" }, 404);
  const { secret, ...dest } = row;
  return c.json({ destination: { ...dest, hasSecret: Boolean(secret) } });
});

crmDestinationsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");
  await db
    .delete(crmDestinations)
    .where(and(eq(crmDestinations.id, id), eq(crmDestinations.orgId, orgId)));
  return c.json({ ok: true });
});

crmDestinationsRouter.post("/:id/test", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");

  const dest = await db.query.crmDestinations.findFirst({
    where: and(eq(crmDestinations.id, id), eq(crmDestinations.orgId, orgId)),
  });
  if (!dest) return c.json({ error: "not_found" }, 404);

  const ok = await sendWebhook(dest.url, dest.secret, {
    type: "test",
    message: "Outrival test push — your destination is wired up.",
    at: new Date().toISOString(),
  });
  if (ok) {
    await db
      .update(crmDestinations)
      .set({ lastPushedAt: new Date() })
      .where(eq(crmDestinations.id, id));
  }
  return c.json({ ok });
});
