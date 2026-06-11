import { Hono } from "hono";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import {
  db,
  signals,
  signalBatches,
  orgNotificationPreferences,
  orgRelevanceThreshold,
  alerts,
  digests,
  organizations,
} from "@outrival/db";
import { rate, type AdminVariables } from "./shared";

export const notificationsRouter = new Hono<{ Variables: AdminVariables }>();

// Notification moderation metrics (patch-26): where the volume goes, how it's
// filtered per layer, and how orgs have configured the knobs. All Postgres, 30d.
notificationsRouter.get("/notification-moderation", async (c) => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [generatedRow] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(signals)
    .where(gte(signals.createdAt, cutoff));
  const generated = generatedRow?.value ?? 0;

  // Filtered per layer (filteredReason set by the dispatcher).
  const reasonRows = await db
    .select({ reason: signals.filteredReason, count: sql<number>`count(*)::int` })
    .from(signals)
    .where(and(gte(signals.createdAt, cutoff), isNotNull(signals.filteredReason)))
    .groupBy(signals.filteredReason);
  const filteredByReason: Record<string, number> = {};
  for (const r of reasonRows) if (r.reason) filteredByReason[r.reason] = r.count;

  // Delivery channel the dispatcher routed each signal to.
  const channelRows = await db
    .select({ channel: signals.dispatchedChannel, count: sql<number>`count(*)::int` })
    .from(signals)
    .where(and(gte(signals.createdAt, cutoff), isNotNull(signals.dispatchedChannel)))
    .groupBy(signals.dispatchedChannel);
  const byChannel: Record<string, number> = {};
  for (const r of channelRows) if (r.channel) byChannel[r.channel] = r.count;

  const [batchedRow] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(signals)
    .where(and(gte(signals.createdAt, cutoff), isNotNull(signals.batchedIntoId)));
  const batchedSignals = batchedRow?.value ?? 0;

  const [batchesRow] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(signalBatches)
    .where(gte(signalBatches.createdAt, cutoff));
  const batchesCreated = batchesRow?.value ?? 0;

  // Org configuration distribution.
  const [prefsRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      timezoneAuto: sql<number>`count(*) filter (where timezone_detected_at is not null)::int`,
      timezoneManual: sql<number>`count(*) filter (where timezone_detected_at is null)::int`,
      batchingOn: sql<number>`count(*) filter (where batching_enabled)::int`,
      defaultQuietHours: sql<number>`count(*) filter (where quiet_hours_start = 22 and quiet_hours_end = 8 and weekend_off)::int`,
    })
    .from(orgNotificationPreferences);

  // Relevance threshold distribution (orgs without a row run the default).
  const thresholdRows = await db
    .select({
      source: orgRelevanceThreshold.source,
      count: sql<number>`count(*)::int`,
      avg: sql<number>`avg(threshold)`,
      stddev: sql<number>`coalesce(stddev_pop(threshold), 0)`,
    })
    .from(orgRelevanceThreshold)
    .groupBy(orgRelevanceThreshold.source);

  return c.json({
    period: 30,
    volume: {
      generated,
      filteredByReason,
      batchedSignals,
      batchingRate: generated > 0 ? batchedSignals / generated : 0,
    },
    byChannel,
    batches: { created: batchesCreated },
    orgConfig: {
      total: prefsRow?.total ?? 0,
      timezoneAuto: prefsRow?.timezoneAuto ?? 0,
      timezoneManual: prefsRow?.timezoneManual ?? 0,
      batchingOn: prefsRow?.batchingOn ?? 0,
      defaultQuietHours: prefsRow?.defaultQuietHours ?? 0,
    },
    thresholds: thresholdRows.map((r) => ({
      source: r.source,
      count: r.count,
      avg: r.avg != null ? Number(r.avg) : null,
      stddev: r.stddev != null ? Number(r.stddev) : null,
    })),
  });
});

// --- Delivery: did alerts and digests actually go out? alerts.error is the
//     ops blind spot today — surface failed email/slack/webhook sends. ---
notificationsRouter.get("/delivery", async (c) => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000);

  const [byChannel, recentFailures, digestAgg] = await Promise.all([
    db
      .select({
        channel: alerts.channel,
        total: sql<number>`count(*)::int`,
        sent: sql<number>`count(*) filter (where ${alerts.sentAt} is not null and ${alerts.error} is null)::int`,
        failed: sql<number>`count(*) filter (where ${alerts.error} is not null)::int`,
      })
      .from(alerts)
      .where(gte(alerts.createdAt, sevenDaysAgo))
      .groupBy(alerts.channel),
    db
      .select({
        id: alerts.id,
        channel: alerts.channel,
        error: alerts.error,
        createdAt: alerts.createdAt,
        orgName: organizations.name,
      })
      .from(alerts)
      .leftJoin(organizations, eq(alerts.orgId, organizations.id))
      .where(and(gte(alerts.createdAt, sevenDaysAgo), isNotNull(alerts.error)))
      .orderBy(desc(alerts.createdAt))
      .limit(20),
    db
      .select({
        generated: sql<number>`count(*)::int`,
        sent: sql<number>`count(*) filter (where ${digests.sentAt} is not null)::int`,
        low: sql<number>`count(*) filter (where ${digests.temperature} = 'low')::int`,
        moderate: sql<number>`count(*) filter (where ${digests.temperature} = 'moderate')::int`,
        high: sql<number>`count(*) filter (where ${digests.temperature} = 'high')::int`,
      })
      .from(digests)
      .where(gte(digests.createdAt, thirtyDaysAgo)),
  ]);

  const d = digestAgg[0];
  return c.json({
    alerts: {
      windowDays: 7,
      byChannel: byChannel.map((r) => ({
        channel: r.channel,
        total: r.total,
        sent: r.sent,
        failed: r.failed,
        failRate: rate(r.failed, r.total),
      })),
      recentFailures: recentFailures.map((r) => ({
        id: r.id,
        channel: r.channel,
        error: r.error,
        orgName: r.orgName,
        createdAt: r.createdAt?.toISOString() ?? null,
      })),
    },
    digests: {
      windowDays: 30,
      generated: d?.generated ?? 0,
      sent: d?.sent ?? 0,
      unsent: (d?.generated ?? 0) - (d?.sent ?? 0),
      temperature: {
        low: d?.low ?? 0,
        moderate: d?.moderate ?? 0,
        high: d?.high ?? 0,
        unknown: (d?.generated ?? 0) - (d?.low ?? 0) - (d?.moderate ?? 0) - (d?.high ?? 0),
      },
    },
  });
});
