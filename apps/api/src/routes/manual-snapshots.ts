import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { manualSnapshots, monitors, competitors, monitorAlternatives } from "@outrival/db";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const manualSnapshotsRouter = new Hono<{ Variables: Variables }>();

manualSnapshotsRouter.use("*", authMiddleware);

const CreateSchema = z.object({
  // Structured content the user entered; shape depends on the source type.
  data: z.record(z.string(), z.unknown()),
  evidenceUrl: z.string().url().optional(),
});

async function resolveOwnedMonitor(monitorId: string, orgId: string) {
  const monitor = await db.query.monitors.findFirst({ where: eq(monitors.id, monitorId) });
  if (!monitor) return null;
  const competitor = await db.query.competitors.findFirst({
    where: and(
      eq(competitors.id, monitor.competitorId),
      eq(competitors.orgId, orgId),
      isNull(competitors.deletedAt),
    ),
  });
  if (!competitor) return null;
  return { monitor, competitor };
}

// Latest manual snapshot for a monitor — drives the "entered manually on X"
// freshness state and lets other features read user-entered data.
manualSnapshotsRouter.get("/:monitorId/latest", async (c) => {
  const monitorId = c.req.param("monitorId");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const owned = await resolveOwnedMonitor(monitorId, orgId);
  if (!owned) return c.json({ error: "Forbidden" }, 403);

  const snapshot = await db.query.manualSnapshots.findFirst({
    where: eq(manualSnapshots.monitorId, monitorId),
    orderBy: desc(manualSnapshots.enteredAt),
  });
  return c.json({ snapshot: snapshot ?? null });
});

// Store user-entered data for an unscrapable source.
manualSnapshotsRouter.post("/:monitorId", async (c) => {
  const monitorId = c.req.param("monitorId");
  const body = await c.req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const owned = await resolveOwnedMonitor(monitorId, orgId);
  if (!owned) return c.json({ error: "Forbidden" }, 403);

  const [snapshot] = await db
    .insert(manualSnapshots)
    .values({
      monitorId,
      userId: user.id,
      sourceType: owned.monitor.sourceType,
      data: parsed.data.data,
      evidenceUrl: parsed.data.evidenceUrl ?? null,
    })
    .returning();

  // If a manual_data_entry alternative was pending for this monitor, resolve it.
  await db
    .update(monitorAlternatives)
    .set({ status: "manual_data", resolvedAt: new Date() })
    .where(
      and(
        eq(monitorAlternatives.monitorId, monitorId),
        eq(monitorAlternatives.type, "manual_data_entry"),
        eq(monitorAlternatives.status, "proposed"),
      ),
    );

  return c.json({ snapshot });
});
