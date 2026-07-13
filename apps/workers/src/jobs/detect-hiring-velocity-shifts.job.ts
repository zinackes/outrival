import { task, logger, tasks, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, competitors, monitors, snapshots, changes } from "@outrival/db";
import { computeHash, uploadToR2 } from "@outrival/shared";
import { getHiringMetricsSeries } from "../lib/analytics";
import {
  detectHiringInflection,
  DEPARTMENT_BUCKET_LABELS,
  type DepartmentBucket,
  type WeekPoint,
} from "@outrival/scrapers/jobs-hiring";

// Triggered off extract-jobs (per competitor) after an authoritative ATS scrape
// upserts the week's hiring_metrics — NOT a cron (the Trigger schedule cap is full).
// Reads the weekly per-department open-role series, detects a velocity inflection
// (a bucket crossing above its 4-week moving average, once per episode), and emits
// ONE grounded "hiring" signal through the same synthetic anchor→snapshot→change→
// generate-signal chain tech_stack / review_shift use. Growth in eng vs sales vs
// marketing is the earliest read on a competitor's real priorities — the strategic
// signal Klue/Crayon sell — so it surfaces before any announcement.

const InputSchema = z.object({ competitorId: z.string() });

// How many trailing ISO weeks to read (needs ≥4 baseline + current, plus slack).
const SERIES_WEEKS = 16;

export const detectHiringVelocityShiftsJob = task({
  id: "detect-hiring-velocity-shifts",
  maxDuration: 60,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const { competitorId } = InputSchema.parse(payload);
    logger.log("Starting detect-hiring-velocity-shifts", { competitorId });

    const competitor = await db.query.competitors.findFirst({
      where: eq(competitors.id, competitorId),
    });
    if (!competitor) throw new AbortTaskRunError(`Competitor ${competitorId} not found`);
    if (competitor.deletedAt) return { skipped: true, reason: "deleted" };
    // A "you're hiring" signal about your own product is noise — velocity signals
    // are about competitors only. (The metrics are still recorded for the self tab.)
    if (competitor.type === "self") return { skipped: true, reason: "self" };

    const threshold = Number(process.env.HIRING_SPIKE_THRESHOLD ?? 0.5);

    const rows = await getHiringMetricsSeries(competitorId, SERIES_WEEKS);
    if (rows.length === 0) return { skipped: true, reason: "no_series" };

    // Group into per-bucket weekly series (already ordered by week ascending).
    const byBucket = new Map<DepartmentBucket, WeekPoint[]>();
    for (const r of rows) {
      const bucket = r.department_bucket as DepartmentBucket;
      const arr = byBucket.get(bucket) ?? [];
      arr.push({ weekStart: r.week_start, openCount: r.open_count });
      byBucket.set(bucket, arr);
    }

    const firing = detectHiringInflection(byBucket, { threshold });
    if (firing.length === 0) {
      logger.log("No hiring velocity inflection", { competitorId });
      return { firing: 0, emitted: 0 };
    }

    // Highest-signal bucket first (high severity, then biggest jump).
    firing.sort(
      (a, b) =>
        (b.severity === "high" ? 1 : 0) - (a.severity === "high" ? 1 : 0) || b.ratio - a.ratio,
    );
    const top = firing[0]!;
    const severity: "medium" | "high" = firing.some((f) => f.severity === "high")
      ? "high"
      : "medium";

    const now = new Date();
    const latestWeek = rows.reduce(
      (mx, r) => (r.week_start > mx ? r.week_start : mx),
      rows[0]!.week_start,
    );

    // Ensure the per-competitor anchor monitor (isActive=false → never scheduled,
    // never scraped; exists only to satisfy the changes → snapshot FK chain).
    let monitor = await db.query.monitors.findFirst({
      where: and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, "hiring_shift")),
    });
    if (!monitor) {
      [monitor] = await db
        .insert(monitors)
        .values({
          competitorId,
          sourceType: "hiring_shift",
          frequency: "weekly", // unused — this monitor is never scheduled
          isActive: false,
          config: {},
        })
        .returning();
    }
    if (!monitor) throw new Error("Failed to ensure hiring_shift monitor");

    const prevSnapshot = await db.query.snapshots.findFirst({
      where: eq(snapshots.monitorId, monitor.id),
      orderBy: desc(snapshots.scrapedAt),
    });

    // Dedup by (week, firing set): re-runs the same week (or a second jobs source)
    // never re-emit an identical inflection. The per-episode "fire once" already
    // comes from the detector (crossing week only); this guards intra-week repeats,
    // and — because the week is in the hash — a genuine re-cross weeks later still
    // emits (a bare firing-set hash would wrongly dedup a repeated episode).
    const firingBuckets = firing.map((f) => f.bucket).sort();
    const contentHash = computeHash(`${latestWeek}:${firingBuckets.join(",")}`);
    if (prevSnapshot?.contentHash === contentHash) {
      logger.log("Same hiring inflection already emitted this week — skipping", { competitorId });
      return { firing: firing.length, emitted: 0, deduped: true };
    }

    const lines = firing.map(
      (f) =>
        `- ${DEPARTMENT_BUCKET_LABELS[f.bucket]}: ${f.openCount} open roles this week vs a ` +
        `4-week average of ${f.baselineAvg.toFixed(1)} (${f.ratio.toFixed(1)}×).`,
    );
    const diffText =
      `Hiring velocity is inflecting up for ${competitor.name}:\n${lines.join("\n")}\n\n` +
      `An acceleration in a department's open roles is a leading indicator of ` +
      `${competitor.name}'s real priorities — the engineering vs sales vs marketing mix ` +
      `reveals where they are investing, usually before any public announcement.`;

    // R2 before DB (snapshots.r2Key is NOT NULL). The snapshot body is the grounded
    // diffText — the same text generate-signal grounds the insight on.
    const r2Key = `snapshots/${competitorId}/hiring_shift/${now.toISOString()}`;
    await uploadToR2(`${r2Key}.txt`, diffText, "text/plain; charset=utf-8", { compress: true });

    const [snapshot] = await db
      .insert(snapshots)
      .values({
        monitorId: monitor.id,
        r2Key,
        contentHash,
        status: "success",
        scrapedAt: now,
        resolvedUrl: competitor.url ?? null,
      })
      .returning();
    if (!snapshot) throw new Error("Failed to insert hiring_shift snapshot");

    const [change] = await db
      .insert(changes)
      .values({
        monitorId: monitor.id,
        snapshotBeforeId: prevSnapshot?.id ?? null,
        snapshotAfterId: snapshot.id,
        diffText,
        diffType: "text",
        rawDiff: {
          firing: firing.map((f) => ({
            bucket: f.bucket,
            openCount: f.openCount,
            baselineAvg: f.baselineAvg,
            ratio: f.ratio,
          })),
        },
        detectedAt: now,
      })
      .returning();
    if (!change) throw new Error("Failed to insert hiring_shift change");

    // Pre-computed classification (bypasses the diff classifier — deterministic).
    await tasks.trigger("generate-signal", {
      changeId: change.id,
      classification: {
        category: "hiring" as const,
        severity,
        is_significant: true,
        reason:
          `${DEPARTMENT_BUCKET_LABELS[top.bucket]} hiring at ${competitor.name} jumped to ` +
          `${top.ratio.toFixed(1)}× its 4-week average`,
        humanChangeBefore: `~${top.baselineAvg.toFixed(1)} ${DEPARTMENT_BUCKET_LABELS[top.bucket]} roles/wk`,
        humanChangeAfter: `${top.openCount} ${DEPARTMENT_BUCKET_LABELS[top.bucket]} roles`,
      },
    });

    logger.log("Completed detect-hiring-velocity-shifts", {
      competitorId,
      firing: firing.length,
      changeId: change.id,
      severity,
    });
    return { firing: firing.length, emitted: 1, changeId: change.id };
  },
});
