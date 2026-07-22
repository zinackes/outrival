import { Hono } from "hono";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { monitors, competitors, changes, signals, alerts, forcedRescanLog } from "@outrival/db";
import { scrapeMonitor } from "@outrival/queue";
import {
  MONITOR_FREQUENCIES,
  validateMonitorUrl,
  computeNextRun,
  forcedRescansPerDay,
  planAllowsMonitorSource,
  type MonitorFrequency,
} from "@outrival/shared";
import { db } from "../lib/db";
import { authMiddleware } from "../middleware/auth";
import { aiIntensiveRateLimit } from "../middleware/ai-intensive-rate-limit";
import { ensureUserOrg } from "../lib/org";
import { enqueueJob } from "../lib/queue";
import {
  getOrgPlan,
  isFrequencyAllowed,
  countUserForcedRescansToday,
  rescanLimitBody,
} from "../lib/plan";

type Variables = { user: { id: string } };

export const monitorsRouter = new Hono<{ Variables: Variables }>();

monitorsRouter.use("*", authMiddleware);

const UpdateMonitorSchema = z.object({
  url: z.string().optional(),
  frequency: z.enum(MONITOR_FREQUENCIES).optional(),
  // Manual pause / enable of a single source (distinct from the competitor-wide
  // monitoringPaused and from the auto-pause after repeated failures). isActive=false
  // makes the scheduler skip it; the data + config are kept.
  isActive: z.boolean().optional(),
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

  const updates: {
    config?: { url: string };
    frequency?: MonitorFrequency;
    isActive?: boolean;
    nextRunAt?: Date | null;
    lastRunAt?: Date | null;
    lastChangedAt?: Date | null;
    lastFailedAt?: Date | null;
    lastError?: string | null;
    markedUnscrapable?: boolean;
    consecutiveFailures?: number;
    requiresLevel?: number | null;
    requiresLevelSince?: Date | null;
    refusedAt?: Date | null;
    refusalReason?: string | null;
    lastFailureCategory?: string | null;
    lastFailureConfidence?: string | null;
    lastFailureEvidence?: null;
    lastFailureDiagnosedAt?: Date | null;
  } = {};

  if (parsed.data.url !== undefined) {
    const valid = validateMonitorUrl(monitor.sourceType, parsed.data.url, competitor.url);
    if (!valid.ok) return c.json({ error: "invalid_monitor_url", reason: valid.error }, 400);
    const currentUrl = (monitor.config as { url?: string } | null)?.url ?? null;
    updates.config = { url: valid.url };
    // Retargeting the source to a different page invalidates the freshness state:
    // the new URL has never been scraped. Clear the last-run markers so (a) the UI
    // stops showing "Scraped just now" (freshness derives from lastRunAt) and (b) the
    // next manual scrape counts as an initial fetch — /:id/run keys "re-scan vs first
    // scrape" off lastRunAt, so it stays UNMETERED against the forced-rescan cap
    // instead of being billed as a forced re-scan of the old page.
    if (valid.url !== currentUrl) {
      updates.lastRunAt = null;
      updates.lastChangedAt = null;
      updates.lastFailedAt = null;
      updates.lastError = null;
      // Everything below diagnoses the OLD url. Keeping any of it would judge the
      // new page on the previous one's record: a source auto-paused after three
      // failures (or refused outright) would stay dead, and the learned cascade
      // level would pin the first scrape at the tier the old host forced.
      //
      // requiresLevel = null re-learns from the bottom, and the cascade only has
      // L0/L1/L2 now (collection doctrine) — there is no L3/L4 to fall back into.
      // Note this deliberately does NOT clear refusal on its own: a NEW url earns
      // a clean slate, which is exactly what a redirected/dead site needs.
      updates.markedUnscrapable = false;
      updates.consecutiveFailures = 0;
      updates.requiresLevel = null;
      updates.requiresLevelSince = null;
      updates.refusedAt = null;
      updates.refusalReason = null;
      updates.lastFailureCategory = null;
      updates.lastFailureConfidence = null;
      updates.lastFailureEvidence = null;
      updates.lastFailureDiagnosedAt = null;
      // Hand it straight back to the hourly scheduler (null = due next tick) so the
      // fix is verified soon without spending the user's forced-rescan budget. An
      // explicit "scan now" stays available and is unmetered, since lastRunAt is
      // now null and both run routes treat that as a first scrape.
      updates.nextRunAt = null;
      // Retargeting an auto-paused source is the user telling us to try again.
      // Only lift OUR pause: a source the user paused by hand stays paused.
      if (monitor.markedUnscrapable && monitor.isActive === false) updates.isActive = true;
    }
  }

  if (parsed.data.frequency !== undefined) {
    const plan = await getOrgPlan(orgId);
    if (!isFrequencyAllowed(plan, parsed.data.frequency)) {
      return c.json({ error: "plan_locked_frequency", frequency: parsed.data.frequency, plan }, 403);
    }
    updates.frequency = parsed.data.frequency;
    // Frequency is the next-run cap; recompute so a tighter cadence takes effect
    // immediately rather than after the previously-scheduled run. Skipped when this
    // same PATCH retargeted the URL: computeNextRun would push the first scrape of a
    // page we have never seen out by the OLD page's staleness multiplier.
    if (updates.lastRunAt === undefined) {
      updates.nextRunAt = computeNextRun(
        parsed.data.frequency,
        monitor.lastChangedAt,
        monitor.createdAt,
      );
    }
  }

  if (parsed.data.isActive !== undefined) {
    // tech_stack / ai_visibility are infra-only anchor monitors that must stay
    // inactive — they have no scraper and the scheduler skips them by design. Don't
    // let a manual toggle flip them on.
    if (monitor.sourceType === "tech_stack" || monitor.sourceType === "ai_visibility") {
      return c.json({ error: "source_not_toggleable", source: monitor.sourceType }, 400);
    }
    updates.isActive = parsed.data.isActive;
    // Re-enabling hands the source back to the hourly scheduler: null nextRunAt = due
    // on the next tick (unless this same PATCH changed frequency, which already
    // recomputed it). Pausing needs no reschedule — inactive monitors are skipped.
    if (parsed.data.isActive && updates.nextRunAt === undefined) {
      updates.nextRunAt = null;
    }
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

monitorsRouter.post("/:id/run", aiIntensiveRateLimit, async (c) => {
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

  // A source frozen by a plan downgrade (its monitor row is kept but the scheduler
  // skips it) must not be refreshable on demand either — mirror the scheduler's gate
  // so a direct trigger can't bypass the entitlement freeze.
  const plan = await getOrgPlan(orgId);
  if (!planAllowsMonitorSource(plan, monitor.sourceType)) {
    return c.json({ error: "plan_locked_source", source: monitor.sourceType, plan }, 403);
  }

  // patch-27 — a genuine re-scan (the source has already run at least once) draws
  // from the per-tier forced-rescan daily cap, exactly like /force-rescan, and is
  // logged so it shows up in usage. A monitor's FIRST scrape (just enabled/switched,
  // never run) is the initial fetch, not a re-scan, so it stays unmetered — otherwise
  // adding a source on a low tier would be blocked by the cap on the spot.
  const isRescan = monitor.lastRunAt !== null;
  let logId: string | undefined;
  if (isRescan) {
    const limit = forcedRescansPerDay(plan);
    const usageToday = await countUserForcedRescansToday(user.id);
    if (usageToday >= limit) return c.json(rescanLimitBody(plan, limit), 429);
    const [log] = await db
      .insert(forcedRescanLog)
      .values({ userId: user.id, orgId, monitorId: monitor.id })
      .returning({ id: forcedRescanLog.id });
    logId = log!.id;
  }

  const jobId = await enqueueJob(scrapeMonitor, {
    monitorId: monitor.id,
    force: true,
    // When metered, pass the log id so the worker stamps the outcome (useful/wasted ratio).
    ...(logId
      ? { triggeredBy: "user_forced_rescan" as const, userId: user.id, forcedRescanLogId: logId }
      : {}),
  });

  if (logId) {
    await db.update(forcedRescanLog).set({ taskId: jobId }).where(eq(forcedRescanLog.id, logId));
  }

  // Mark the monitor as scraping so the in-progress state survives a page
  // refresh (UI derives "running" from scrapeStartedAt > lastRunAt). Clear any
  // previous failure so the row flips straight to running.
  await db
    .update(monitors)
    .set({ scrapeStartedAt: new Date(), lastFailedAt: null, lastError: null })
    .where(eq(monitors.id, monitor.id));

  return c.json({ runId: jobId, monitorId: monitor.id });
});

// Patch-27 — user-forced re-scan from the stale-data "Re-scan" affordance. Like
// /:id/run it enforces the per-tier daily cap and logs a forced_rescan_log row
// (counted per user), and — also like /run — exempts a monitor's first scrape
// (never run, e.g. just retargeted to a new URL): that's an initial fetch, not a
// re-scan of existing data, so it isn't metered and returns a null log id. Metered
// re-scans return the log id so the client can poll the outcome for its contextual
// toast. The scrape reuses `force: true`, which bypasses the idempotence window + hash dedup.
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

  // A monitor that has never run (freshly enabled, or just retargeted to a new URL
  // which cleared lastRunAt) is doing a FIRST scrape, not a forced re-scan of existing
  // data — exempt it from the per-tier cap + log, exactly like /:id/run. Only genuine
  // re-scans are metered and get a log row (which the client polls for its outcome).
  const isRescan = monitor.lastRunAt !== null;
  const plan = await getOrgPlan(orgId);
  // Same entitlement gate as /:id/run — a downgraded org can't force-refresh a
  // premium source the scheduler has frozen.
  if (!planAllowsMonitorSource(plan, monitor.sourceType)) {
    return c.json({ error: "plan_locked_source", source: monitor.sourceType, plan }, 403);
  }
  const limit = forcedRescansPerDay(plan);
  let usageToday = 0;
  let logId: string | null = null;
  if (isRescan) {
    usageToday = await countUserForcedRescansToday(user.id);
    if (usageToday >= limit) {
      return c.json(rescanLimitBody(plan, limit), 429);
    }
    // Log first so the worker can stamp resultCapturedAt/hadNewSignal via the id.
    const [log] = await db
      .insert(forcedRescanLog)
      .values({ userId: user.id, orgId, monitorId: monitor.id })
      .returning({ id: forcedRescanLog.id });
    logId = log!.id;
  }

  const jobId = await enqueueJob(scrapeMonitor, {
    monitorId: monitor.id,
    force: true,
    ...(logId
      ? { triggeredBy: "user_forced_rescan" as const, userId: user.id, forcedRescanLogId: logId }
      : {}),
  });

  if (logId) {
    await db.update(forcedRescanLog).set({ taskId: jobId }).where(eq(forcedRescanLog.id, logId));
  }
  await db
    .update(monitors)
    .set({ scrapeStartedAt: new Date(), lastFailedAt: null, lastError: null })
    .where(eq(monitors.id, monitor.id));

  return c.json({
    ok: true,
    runId: jobId,
    // null when unmetered (first scrape): there's no log row to poll — the client
    // falls back to its own scrape-progress polling.
    rescanLogId: logId,
    monitorId: monitor.id,
    metered: isRescan,
    usageToday: isRescan ? usageToday + 1 : usageToday,
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
    failed: log.failed ?? false,
    hadNewSignal: log.hadNewSignal,
    nextRunAt: monitor?.nextRunAt ?? null,
  });
});
