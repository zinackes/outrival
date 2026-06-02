import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { structuralChanges, competitors, monitors } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const structuralChangesRouter = new Hono<{ Variables: Variables }>();

structuralChangesRouter.use("*", authMiddleware);

const StatusSchema = z.enum(["detected", "confirmed", "false_positive", "resolved"]);

const ResolveSchema = z.object({
  resolution: z.union([
    z.literal("confirmed_paused"),
    z.literal("false_positive"),
    z.literal("confirmed_continue"),
    z.string().regex(/^replaced_with:.+/), // replaced_with:<competitorId>
  ]),
});

// List structural changes for the caller's competitors, defaulting to the ones
// awaiting a decision (status=detected).
structuralChangesRouter.get("/", async (c) => {
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);
  const statusParam = c.req.query("status");
  const status = StatusSchema.safeParse(statusParam ?? "detected");
  if (!status.success) return c.json({ error: "Invalid status" }, 400);

  const orgCompetitors = await db.query.competitors.findMany({
    where: and(eq(competitors.orgId, orgId), isNull(competitors.deletedAt)),
    columns: { id: true, name: true },
  });
  if (orgCompetitors.length === 0) return c.json({ changes: [] });
  const byId = new Map(orgCompetitors.map((co) => [co.id, co.name]));

  const rows = await db.query.structuralChanges.findMany({
    where: and(
      inArray(structuralChanges.competitorId, [...byId.keys()]),
      eq(structuralChanges.status, status.data),
    ),
    orderBy: desc(structuralChanges.detectedAt),
  });

  return c.json({
    changes: rows.map((r) => ({ ...r, competitorName: byId.get(r.competitorId) ?? null })),
  });
});

// Resolve a structural change — always explicit, never auto-resolved (patch-23).
structuralChangesRouter.post("/:id/resolve", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = ResolveSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const change = await db.query.structuralChanges.findFirst({
    where: eq(structuralChanges.id, id),
  });
  if (!change) return c.json({ error: "Not found" }, 404);

  const competitor = await db.query.competitors.findFirst({
    where: and(
      eq(competitors.id, change.competitorId),
      eq(competitors.orgId, orgId),
      isNull(competitors.deletedAt),
    ),
  });
  if (!competitor) return c.json({ error: "Forbidden" }, 403);

  const resolution = parsed.data.resolution;
  let status: "confirmed" | "false_positive" | "resolved";
  if (resolution === "false_positive") status = "false_positive";
  else if (resolution === "confirmed_continue") status = "confirmed";
  else status = "resolved"; // confirmed_paused | replaced_with:<id>

  // confirmed_paused → stop scraping this competitor's monitors.
  if (resolution === "confirmed_paused") {
    await db
      .update(monitors)
      .set({ isActive: false })
      .where(eq(monitors.competitorId, change.competitorId));
  }

  await db
    .update(structuralChanges)
    .set({ status, resolution, resolvedAt: new Date() })
    .where(eq(structuralChanges.id, id));

  return c.json({ ok: true, status });
});
