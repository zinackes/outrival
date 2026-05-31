import { Hono } from "hono";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { monitors, competitors } from "@outrival/db";
import { tasks } from "@trigger.dev/sdk/v3";
import {
  MONITOR_FREQUENCIES,
  validateMonitorUrl,
  computeNextRun,
  type MonitorFrequency,
} from "@outrival/shared";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { getOrgPlan, isFrequencyAllowed } from "../lib/plan";

type Variables = { user: { id: string } };

export const monitorsRouter = new Hono<{ Variables: Variables }>();

monitorsRouter.use("*", authMiddleware);

const UpdateMonitorSchema = z.object({
  url: z.string().optional(),
  frequency: z.enum(MONITOR_FREQUENCIES).optional(),
});

monitorsRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = UpdateMonitorSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);

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

  const updates: { config?: { url: string }; frequency?: MonitorFrequency; nextRunAt?: Date } = {};

  if (parsed.data.url !== undefined) {
    const valid = validateMonitorUrl(monitor.sourceType, parsed.data.url, competitor.url);
    if (!valid.ok) return c.json({ error: "invalid_monitor_url", reason: valid.error }, 400);
    updates.config = { url: valid.url };
  }

  if (parsed.data.frequency !== undefined) {
    const plan = await getOrgPlan(orgId);
    if (!isFrequencyAllowed(plan, parsed.data.frequency)) {
      return c.json({ error: "plan_locked_frequency", frequency: parsed.data.frequency, plan }, 403);
    }
    updates.frequency = parsed.data.frequency;
    // Frequency is the next-run cap; recompute so a tighter cadence takes effect
    // immediately rather than after the previously-scheduled run.
    updates.nextRunAt = computeNextRun(
      parsed.data.frequency,
      monitor.lastChangedAt,
      monitor.createdAt,
    );
  }

  if (Object.keys(updates).length === 0) return c.json({ monitor });

  const [updated] = await db
    .update(monitors)
    .set(updates)
    .where(eq(monitors.id, id))
    .returning();
  return c.json({ monitor: updated ?? monitor });
});

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

  // Mark the monitor as scraping so the in-progress state survives a page
  // refresh (UI derives "running" from scrapeStartedAt > lastRunAt). Clear any
  // previous failure so the row flips straight to running.
  await db
    .update(monitors)
    .set({ scrapeStartedAt: new Date(), lastFailedAt: null, lastError: null })
    .where(eq(monitors.id, monitor.id));

  return c.json({ runId: handle.id, monitorId: monitor.id });
});
