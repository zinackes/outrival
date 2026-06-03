import { Hono } from "hono";
import { z } from "zod";
import { and, count, eq, gte, inArray, isNull } from "drizzle-orm";
import { monitors, competitors, changes, signals, alerts, forcedRescanLog } from "@outrival/db";
import { tasks } from "@trigger.dev/sdk/v3";
import {
  MONITOR_FREQUENCIES,
  validateMonitorUrl,
  computeNextRun,
  type MonitorFrequency,
  type Plan,
} from "@outrival/shared";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { ensureUserOrg } from "../lib/org";
import { getOrgPlan, isFrequencyAllowed } from "../lib/plan";

// Patch-27 — per-tier daily cap on user-forced re-scans (env-overridable).
const FORCED_RESCAN_FALLBACK: Record<Plan, number> = {
  free: 1,
  starter: 5,
  pro: 20,
  business: 999,
};
function dailyForcedRescanLimit(plan: Plan): number {
  const env: Record<Plan, string | undefined> = {
    free: process.env.FORCED_RESCAN_LIMIT_FREE,
    starter: process.env.FORCED_RESCAN_LIMIT_STARTER,
    pro: process.env.FORCED_RESCAN_LIMIT_PRO,
    business: process.env.FORCED_RESCAN_LIMIT_BUSINESS,
  };
  const n = Number(env[plan]);
  return Number.isFinite(n) && n > 0 ? n : FORCED_RESCAN_FALLBACK[plan];
}

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

monitorsRouter.delete("/:id", async (c) => {
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

  // Hard delete. None of monitor ← changes ← signals ← alerts cascades, and
  // changes pin snapshots, so tear dependents down in order: alerts → signals →
  // changes → monitor (snapshots cascade once the monitor is gone).
  await db.transaction(async (tx) => {
    const monitorChanges = await tx
      .select({ id: changes.id })
      .from(changes)
      .where(eq(changes.monitorId, id));
    const changeIds = monitorChanges.map((ch) => ch.id);
    if (changeIds.length > 0) {
      const changeSignals = await tx
        .select({ id: signals.id })
        .from(signals)
        .where(inArray(signals.changeId, changeIds));
      const signalIds = changeSignals.map((s) => s.id);
      if (signalIds.length > 0) {
        await tx.delete(alerts).where(inArray(alerts.signalId, signalIds));
        await tx.delete(signals).where(inArray(signals.changeId, changeIds));
      }
      await tx.delete(changes).where(eq(changes.monitorId, id));
    }
    await tx.delete(monitors).where(eq(monitors.id, id));
  });

  return c.json({ ok: true });
});

// Whether a manual re-scrape is worth it (patch-22 intelligent rate limiting).
// signals carry no monitorId (linked via change_id), so staleness uses the monitor's
// own lastRunAt + lastChangedAt: scraped <30min ago → "very_recent"; scraped <24h ago
// with no change detected since that run → "fresh"; otherwise "outdated". Never blocking.
monitorsRouter.get("/:id/staleness", async (c) => {
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

  const lastRunAt = monitor.lastRunAt;
  const minutesSince = lastRunAt ? (Date.now() - lastRunAt.getTime()) / 60000 : Infinity;
  // A change detected at/after the last run means the page is actively moving.
  const changedSinceRun =
    !!monitor.lastChangedAt &&
    !!lastRunAt &&
    monitor.lastChangedAt.getTime() >= lastRunAt.getTime();

  let staleness: "very_recent" | "fresh" | "outdated";
  if (minutesSince < 30) staleness = "very_recent";
  else if (minutesSince < 1440 && !changedSinceRun) staleness = "fresh";
  else staleness = "outdated";

  return c.json({
    staleness,
    needsRescrape: staleness === "outdated",
    lastRunAt,
    lastChangedAt: monitor.lastChangedAt,
  });
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

// Patch-27 — user-forced re-scan from the stale-data "Re-scan" affordance.
// Distinct from /:id/run: it enforces a per-tier daily limit (counted per user)
// and records a forced_rescan_log row so the worker can stamp the outcome and the
// admin dashboard can measure the useful/wasted ratio. The scrape itself reuses
// `force: true`, which already bypasses the idempotence window and the hash dedup.
monitorsRouter.post("/:id/force-rescan", async (c) => {
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

  const plan = await getOrgPlan(orgId);
  const limit = dailyForcedRescanLimit(plan);
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [usage] = await db
    .select({ value: count() })
    .from(forcedRescanLog)
    .where(
      and(eq(forcedRescanLog.userId, user.id), gte(forcedRescanLog.triggeredAt, dayStart)),
    );
  const usageToday = usage?.value ?? 0;
  if (usageToday >= limit) {
    return c.json(
      {
        error: {
          code: "rescan_limit_reached",
          message: `You've reached your limit of ${limit} forced re-scan${limit > 1 ? "s" : ""} today (${plan} plan). It resets tomorrow.`,
          upgradeHint: plan !== "business",
        },
      },
      429,
    );
  }

  // Log first so the worker can stamp resultCapturedAt/hadNewSignal via the id.
  const [log] = await db
    .insert(forcedRescanLog)
    .values({ userId: user.id, orgId, monitorId: monitor.id })
    .returning({ id: forcedRescanLog.id });
  const logId = log!.id;

  const handle = await tasks.trigger("scrape-monitor", {
    monitorId: monitor.id,
    force: true,
    triggeredBy: "user_forced_rescan",
    userId: user.id,
    forcedRescanLogId: logId,
  });

  await db.update(forcedRescanLog).set({ taskId: handle.id }).where(eq(forcedRescanLog.id, logId));
  await db
    .update(monitors)
    .set({ scrapeStartedAt: new Date(), lastFailedAt: null, lastError: null })
    .where(eq(monitors.id, monitor.id));

  return c.json({
    ok: true,
    runId: handle.id,
    rescanLogId: logId,
    monitorId: monitor.id,
    usageToday: usageToday + 1,
    dailyLimit: limit,
  });
});

// Patch-27 — poll a forced re-scan's outcome. Signals are generated downstream,
// so the worker records "found a change?" on the log row when the scrape ends;
// the client polls this until `done` to show the contextual toast.
monitorsRouter.get("/force-rescan/:logId/status", async (c) => {
  const logId = c.req.param("logId");
  const user = c.get("user");
  const orgId = await ensureUserOrg(user.id);

  const log = await db.query.forcedRescanLog.findFirst({
    where: eq(forcedRescanLog.id, logId),
  });
  if (!log || log.orgId !== orgId) return c.json({ error: "Not found" }, 404);

  const monitor = await db.query.monitors.findFirst({
    where: eq(monitors.id, log.monitorId),
    columns: { nextRunAt: true },
  });

  return c.json({
    done: log.resultCapturedAt !== null,
    hadNewSignal: log.hadNewSignal,
    nextRunAt: monitor?.nextRunAt ?? null,
  });
});
