import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { savedViews, type SavedViewFilters } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const savedViewsRouter = new Hono<{ Variables: Variables }>();

savedViewsRouter.use("*", authMiddleware);

// Saved Signals-feed filter sets (Phase B). Org-scoped CRUD. See
// docs/activation-retention.md.

function sanitizeFilters(raw: unknown): SavedViewFilters {
  const f = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 100) : undefined;
  const out: SavedViewFilters = {};
  const competitorIds = strArr(f.competitorIds);
  if (competitorIds) out.competitorIds = competitorIds;
  const categories = strArr(f.categories);
  if (categories) out.categories = categories;
  const severities = strArr(f.severities);
  if (severities) out.severities = severities;
  if (typeof f.view === "string") out.view = f.view.slice(0, 40);
  return out;
}

savedViewsRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const rows = await db
    .select({
      id: savedViews.id,
      name: savedViews.name,
      filters: savedViews.filters,
      createdAt: savedViews.createdAt,
    })
    .from(savedViews)
    .where(eq(savedViews.orgId, orgId))
    .orderBy(desc(savedViews.createdAt));
  return c.json({ views: rows });
});

savedViewsRouter.post("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; filters?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) return c.json({ error: "name_required" }, 400);

  const [row] = await db
    .insert(savedViews)
    .values({ orgId, userId: user.id, name, filters: sanitizeFilters(body.filters) })
    .returning({
      id: savedViews.id,
      name: savedViews.name,
      filters: savedViews.filters,
      createdAt: savedViews.createdAt,
    });
  return c.json({ view: row }, 201);
});

savedViewsRouter.patch("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: unknown;
    filters?: unknown;
  };

  const update: { name?: string; filters?: SavedViewFilters } = {};
  if (typeof body.name === "string") {
    const name = body.name.trim().slice(0, 80);
    if (!name) return c.json({ error: "name_required" }, 400);
    update.name = name;
  }
  if (body.filters !== undefined) update.filters = sanitizeFilters(body.filters);
  if (update.name === undefined && update.filters === undefined)
    return c.json({ error: "nothing_to_update" }, 400);

  const [row] = await db
    .update(savedViews)
    .set(update)
    .where(and(eq(savedViews.id, id), eq(savedViews.orgId, orgId)))
    .returning({
      id: savedViews.id,
      name: savedViews.name,
      filters: savedViews.filters,
      createdAt: savedViews.createdAt,
    });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ view: row });
});

savedViewsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const id = c.req.param("id");
  await db.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.orgId, orgId)));
  return c.json({ ok: true });
});
