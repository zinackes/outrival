import { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { tasks } from "@trigger.dev/sdk/v3";
import { monitorAlternatives, monitors, competitors } from "@outrival/db";
import { validateMonitorUrl, computeNextRun } from "@outrival/shared";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";

type Variables = { user: { id: string } };

export const monitorAlternativesRouter = new Hono<{ Variables: Variables }>();

monitorAlternativesRouter.use("*", authMiddleware);

// Resolve a monitor and assert it belongs to the caller's org. Returns the
// monitor + its competitor, or null when not found / not owned.
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

// List the proposed alternatives for one of the caller's monitors.
monitorAlternativesRouter.get("/:monitorId", async (c) => {
  const monitorId = c.req.param("monitorId");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const owned = await resolveOwnedMonitor(monitorId, orgId);
  if (!owned) return c.json({ error: "Forbidden" }, 403);

  const alternatives = await db.query.monitorAlternatives.findMany({
    where: and(
      eq(monitorAlternatives.monitorId, monitorId),
      eq(monitorAlternatives.status, "proposed"),
    ),
    orderBy: desc(monitorAlternatives.createdAt),
  });
  return c.json({ alternatives });
});

// Accept an alternative. The action depends on its type:
//   different_url     → repoint the monitor at the suggested URL + rescrape
//   pause_source      → deactivate the monitor
//   manual_data_entry → mark for manual entry (the data is submitted separately)
//   replace_competitor→ acknowledge (the user removes/replaces the competitor)
monitorAlternativesRouter.post("/:id/accept", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const alternative = await db.query.monitorAlternatives.findFirst({
    where: eq(monitorAlternatives.id, id),
  });
  if (!alternative) return c.json({ error: "Alternative not found" }, 404);

  const owned = await resolveOwnedMonitor(alternative.monitorId, orgId);
  if (!owned) return c.json({ error: "Forbidden" }, 403);
  const { monitor } = owned;

  let runId: string | null = null;

  if (alternative.type === "different_url") {
    if (!alternative.suggestedUrl) return c.json({ error: "Alternative has no URL" }, 400);
    const valid = validateMonitorUrl(monitor.sourceType, alternative.suggestedUrl, owned.competitor.url);
    if (!valid.ok) return c.json({ error: "invalid_monitor_url", reason: valid.error }, 400);
    // Repoint the existing monitor (keeps the 1-per-(competitor,source) invariant)
    // and clear the failure state so it scrapes the new URL cleanly.
    await db
      .update(monitors)
      .set({
        config: { url: valid.url },
        isActive: true,
        markedUnscrapable: false,
        consecutiveFailures: 0,
        apiCaptureEnabled: false,
        apiCaptureEndpoints: null,
        nextRunAt: computeNextRun(monitor.frequency, monitor.lastChangedAt, monitor.createdAt),
      })
      .where(eq(monitors.id, monitor.id));
    const handle = await tasks.trigger("scrape-monitor", { monitorId: monitor.id, force: true });
    runId = handle.id;
    await db
      .update(monitors)
      .set({ scrapeStartedAt: new Date(), lastFailedAt: null, lastError: null })
      .where(eq(monitors.id, monitor.id));
  } else if (alternative.type === "pause_source") {
    await db.update(monitors).set({ isActive: false }).where(eq(monitors.id, monitor.id));
  }
  // manual_data_entry / replace_competitor: no monitor mutation here.

  const status = alternative.type === "manual_data_entry" ? "manual_data" : "accepted";
  await db
    .update(monitorAlternatives)
    .set({ status, resolvedAt: new Date() })
    .where(eq(monitorAlternatives.id, id));

  return c.json({ ok: true, runId });
});

// Resume an auto-paused source ("Resume anyway"): clear the failure state, re-enable
// the monitor so the scheduler picks it up again, resolve any proposed alternatives so
// the panel disappears, and kick off a fresh scrape. The cascade will re-learn whether
// it's reachable; if it fails again it auto-pauses once more.
monitorAlternativesRouter.post("/:monitorId/resume", async (c) => {
  const monitorId = c.req.param("monitorId");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const owned = await resolveOwnedMonitor(monitorId, orgId);
  if (!owned) return c.json({ error: "Forbidden" }, 403);
  const { monitor } = owned;

  await db
    .update(monitors)
    .set({
      isActive: true,
      markedUnscrapable: false,
      consecutiveFailures: 0,
      scrapeStartedAt: new Date(),
      lastFailedAt: null,
      lastError: null,
      nextRunAt: computeNextRun(monitor.frequency, monitor.lastChangedAt, monitor.createdAt),
    })
    .where(eq(monitors.id, monitor.id));

  await db
    .update(monitorAlternatives)
    .set({ status: "accepted", resolvedAt: new Date() })
    .where(
      and(
        eq(monitorAlternatives.monitorId, monitor.id),
        eq(monitorAlternatives.status, "proposed"),
      ),
    );

  const handle = await tasks.trigger("scrape-monitor", { monitorId: monitor.id, force: true });
  return c.json({ ok: true, runId: handle.id });
});

monitorAlternativesRouter.post("/:id/reject", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const alternative = await db.query.monitorAlternatives.findFirst({
    where: eq(monitorAlternatives.id, id),
  });
  if (!alternative) return c.json({ error: "Alternative not found" }, 404);

  const owned = await resolveOwnedMonitor(alternative.monitorId, orgId);
  if (!owned) return c.json({ error: "Forbidden" }, 403);

  await db
    .update(monitorAlternatives)
    .set({ status: "rejected", resolvedAt: new Date() })
    .where(eq(monitorAlternatives.id, id));
  return c.json({ ok: true });
});
